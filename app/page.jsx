"use client";

import { useState, useRef, useCallback, useMemo } from "react";

const EXTRACTION_SYSTEM = `You are a question extraction engine. You convert questions (MCQs, matching, or written/QROC) from raw text into a strict JSON array. Return ONLY a valid JSON array — no markdown, no code fences, no explanation, nothing else.

Each element must have exactly these fields:
- cas: (string) Shared clinical scenario or matching instruction. CRITICAL: ONLY use this field if the EXACT SAME scenario applies to 2 or more questions. If a scenario applies to ONLY ONE question, include it directly in the 'text' field and set 'cas' to "".
- text: (string) The specific question stem. Strip any numeric/letter prefixes (like "1.", "Q2", "A."). For multi-part shared-context questions, place only the sub-question here — never repeat the shared context.
- options: (array of strings) Answer choices with all prefixes removed. Empty array [] for QROC/written questions.
- correct: (string) The correct answer letter(s) based on your knowledge (e.g. "A", "B,D"). Empty string "" for QROC.
- type: (string) "QCS" for MCQs and matching, "QROC" for written/open-ended.
- exp: (string) Explanation if present in source; generate a concise one for QROC. Empty "" for MCQs with no explanation provided.`;

function convertToCSV(questions, { tag, year, lecture, subject }) {
  const headers = [
    "Cas",
    "Text",
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "G",
    "H",
    "Correct",
    "Year",
    "subcategoryName",
    "Tag",
    "Type",
    "tagSuggere",
    "EXP",
  ];
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return s.includes(",") ||
      s.includes('"') ||
      s.includes("\n") ||
      s.includes("\r")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const rows = [headers.join(",")];
  for (const q of questions) {
    const opts = Array.isArray(q.options) ? q.options : [];
    rows.push(
      [
        q.cas || "",
        q.text || "",
        opts[0] || "",
        opts[1] || "",
        opts[2] || "",
        opts[3] || "",
        opts[4] || "",
        opts[5] || "",
        opts[6] || "",
        opts[7] || "",
        q.correct || "",
        year || "",
        lecture || "",
        tag || "",
        q.type || "QCS",
        subject || "",
        q.exp || "",
      ]
        .map(esc)
        .join(","),
    );
  }
  return rows.join("\n");
}

function Spinner() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        color: "var(--color-text-secondary)",
        fontSize: 13,
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ animation: "spin 0.9s linear infinite" }}
      >
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      </svg>
      <span id="status-msg">Extracting questions…</span>
    </div>
  );
}

function computeTag(source, examType, professorName, customSource, year) {
  if (source === "Exams") {
    let t = `Exams, ${examType}`;
    if (year) t += ` ${year}`;
    return t;
  }
  if (source === "Professor")
    return professorName.trim()
      ? `Professor, ${professorName.trim()}`
      : "Professor";
  if (source === "Other") return customSource.trim();
  return source; // Department or anything else
}

export default function App() {
  const [inputText, setInputText] = useState("");
  const [pdfFile, setPdfFile] = useState(null);
  // Classification
  const [source, setSource] = useState("");
  const [examType, setExamType] = useState("End");
  const [professorName, setProfessorName] = useState("");
  const [customSource, setCustomSource] = useState("");
  const [subject, setSubject] = useState("");
  const [lecture, setLecture] = useState("");
  const [year, setYear] = useState("");

  // Model Selection
  const [customInstructions, setCustomInstructions] = useState("");

  const [step, setStep] = useState("input");
  const [jsonResult, setJsonResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState("csv");
  const [statusMsg, setStatusMsg] = useState("Extracting questions…");
  const fileRef = useRef(null);

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setPdfFile(f);
    setInputText("");
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && (f.type === "application/pdf" || f.type === "text/plain")) {
      setPdfFile(f);
      setInputText("");
    }
  }, []);

  const handleConvert = async () => {
    if (!inputText.trim() && !pdfFile) return;
    if (!source) {
      setErrorMsg("Please select a Source.");
      return;
    }
    if (source === "Other" && !customSource.trim()) {
      setErrorMsg("Please provide a Custom Source Name.");
      return;
    }
    setErrorMsg("");
    setStep("processing");
    setStatusMsg("Extracting questions…");

    const tag = computeTag(source, examType, professorName, customSource, year);

    try {
      const parts = [];

      if (pdfFile) {
        setStatusMsg("Reading file…");
        const base64Data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(pdfFile);
          reader.onload = () => resolve(reader.result.split(",")[1]);
          reader.onerror = (error) => reject(error);
        });

        const mimeType =
          pdfFile.type ||
          (pdfFile.name.toLowerCase().endsWith(".pdf")
            ? "application/pdf"
            : "text/plain");

        parts.push({
          inlineData: {
            data: base64Data,
            mimeType: mimeType,
          },
        });
        parts.push({
          text: "Extract all questions from this file and return them as a JSON array per the schema.",
        });
      } else {
        parts.push({
          text: `Extract all questions from the following text and return them as a JSON array per the schema.\n\n${inputText}`,
        });
      }

      if (customInstructions.trim()) {
        parts.push({
          text: `IMPORTANT CUSTOM INSTRUCTIONS: ${customInstructions}`,
        });
      }

      setStatusMsg("Calling Gemini AI…");

      const apiKeys = (process.env.NEXT_PUBLIC_GEMINI_API_KEY || "").split(",").map(k => k.trim()).filter(Boolean);
      if (apiKeys.length === 0) {
        throw new Error("No Gemini API key configured.");
      }

      let response;
      for (let i = 0; i < apiKeys.length; i++) {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKeys[i]}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: {
                parts: [{ text: EXTRACTION_SYSTEM }],
              },
              contents: [{ role: "user", parts }],
              generationConfig: {
                responseMimeType: "application/json",
              },
            }),
          },
        );

        if (response.ok) {
          break;
        }

        const errorText = await response.text();
        if (response.status === 429 && i < apiKeys.length - 1) {
          console.warn(`API key ${i + 1} exhausted, rotating to next key...`);
          continue;
        }

        throw new Error(`Gemini API Error: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

      setStatusMsg("Parsing results…");

      let clean = raw;
      const firstBracket = raw.indexOf("[");
      const lastBracket = raw.lastIndexOf("]");

      if (
        firstBracket !== -1 &&
        lastBracket !== -1 &&
        lastBracket > firstBracket
      ) {
        clean = raw.substring(firstBracket, lastBracket + 1);
      } else {
        clean = raw
          .replace(/^[\s\S]*?```(?:json)?\s*/i, "")
          .replace(/```[\s\S]*$/, "")
          .trim();
      }

      let parsed;
      try {
        parsed = JSON.parse(clean);
      } catch {
        console.error("Raw model response:", raw);
        throw new Error(
          "Model returned invalid JSON. Try again or simplify the input.",
        );
      }

      if (!Array.isArray(parsed))
        throw new Error("Expected a JSON array from the model.");

      setJsonResult(parsed);
      setStep("done");
    } catch (e) {
      setErrorMsg(e.message);
      setStep("error");
    }
  };

  const handleCopy = () => {
    const content =
      activeTab === "csv" ? csvResult : JSON.stringify(jsonResult, null, 2);
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownload = () => {
    const blob = new Blob([csvResult], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mbset_export_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    setStep("input");
    setJsonResult(null);
    setErrorMsg("");
    setPdfFile(null);
    setCustomInstructions("");
  };

  const questionCount = jsonResult ? jsonResult.length : 0;
  const inputReady =
    (inputText.trim() || pdfFile) &&
    source &&
    (source !== "Other" || customSource.trim());
  const computedTag = source
    ? computeTag(source, examType, professorName, customSource, year)
    : "";

  const csvResult = useMemo(() => {
    if (!jsonResult) return "";
    return convertToCSV(jsonResult, {
      tag: computedTag,
      year,
      lecture,
      subject,
    });
  }, [jsonResult, computedTag, year, lecture, subject]);

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        .card { background:var(--color-background-primary); border:0.5px solid var(--color-border-tertiary); border-radius:var(--border-radius-lg); }
        .section-label { font-size:11px; font-weight:500; letter-spacing:.06em; text-transform:uppercase; color:var(--color-text-secondary); margin:0 0 6px; }
        .field-wrap { margin-bottom:14px; }
        .field-row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .field-row-3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; }
        .tab-btn { background:none; border:none; padding:6px 14px; font-size:13px; cursor:pointer; border-radius:6px; color:var(--color-text-secondary); transition:.15s; }
        .tab-btn.active { background:var(--color-background-secondary); color:var(--color-text-primary); font-weight:500; }
        .csv-area { font-family:var(--font-mono); font-size:12px; white-space:pre; overflow:auto; padding:16px; max-height:380px; background:var(--color-background-secondary); border-radius:var(--border-radius-md); color:var(--color-text-primary); line-height:1.6; }
        .stat-pill { display:inline-flex; align-items:center; gap:5px; font-size:12px; padding:3px 10px; border-radius:99px; background:var(--color-background-secondary); color:var(--color-text-secondary); border:0.5px solid var(--color-border-tertiary); }
        .action-btn { display:inline-flex; align-items:center; gap:6px; padding:7px 14px; font-size:13px; border-radius:var(--border-radius-md); cursor:pointer; transition:.15s; font-weight:500; }
        .btn-primary { background:var(--color-text-primary); color:var(--color-background-primary); border:none; }
        .btn-primary:hover { opacity:.88; }
        .btn-primary:disabled { opacity:.4; cursor:not-allowed; }
        .btn-ghost { background:none; border:0.5px solid var(--color-border-secondary); color:var(--color-text-primary); }
        .btn-ghost:hover { background:var(--color-background-secondary); }
        .drop-zone { border:1.5px dashed var(--color-border-secondary); border-radius:var(--border-radius-lg); padding:24px; text-align:center; cursor:pointer; transition:.15s; color:var(--color-text-secondary); font-size:13px; }
        .drop-zone:hover, .drop-zone.drag-over { border-color:var(--color-border-primary); background:var(--color-background-secondary); }
        .badge-qcs { background:#EAF3DE; color:#3B6D11; font-size:10px; padding:1px 6px; border-radius:4px; font-weight:500; }
        .badge-qroc { background:#E6F1FB; color:#185FA5; font-size:10px; padding:1px 6px; border-radius:4px; font-weight:500; }
        .q-row { display:flex; gap:10px; align-items:flex-start; padding:10px 0; border-bottom:0.5px solid var(--color-border-tertiary); animation:fadeIn .2s ease; }
        .q-row:last-child { border-bottom:none; }
        .q-num { min-width:22px; height:22px; display:flex; align-items:center; justify-content:center; border-radius:50%; background:var(--color-background-secondary); font-size:11px; font-weight:500; color:var(--color-text-secondary); flex-shrink:0; }
        .q-text { font-size:13px; color:var(--color-text-primary); flex:1; line-height:1.5; }
        .q-correct { font-size:12px; font-weight:500; color:#3B6D11; background:#EAF3DE; padding:1px 8px; border-radius:4px; flex-shrink:0; }
        .separator { height:.5px; background:var(--color-border-tertiary); margin:16px 0; }
      `}</style>

      <h2 className="sr-only">
        MBSet Question Importer — Convert questions to MBSet CSV format
      </h2>

      <div
        style={{
          padding: "1.5rem 0",
          maxWidth: 780,
          margin: "0 auto",
          animation: "fadeIn .3s ease",
        }}
      >
        <div
          style={{
            marginBottom: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div>
            <p
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 500,
                color: "var(--color-text-primary)",
              }}
            >
              MBSet importer
            </p>
            <p
              style={{
                margin: "2px 0 0",
                fontSize: 13,
                color: "var(--color-text-secondary)",
              }}
            >
              Paste questions or upload a PDF → get a clean MBSet CSV
            </p>
          </div>
          {step === "done" && (
            <button
              className="action-btn btn-ghost"
              onClick={handleReset}
              style={{ fontSize: 12 }}
            >
              <i
                className="ti ti-refresh"
                aria-hidden="true"
                style={{ fontSize: 14 }}
              ></i>{" "}
              Start over
            </button>
          )}
        </div>

        {step !== "processing" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {step !== "done" && (
              <div className="card" style={{ padding: "1.25rem" }}>
                <p className="section-label">1 — Questions source</p>
                <div className="field-wrap">
                  <textarea
                    value={inputText}
                    onChange={(e) => {
                      setInputText(e.target.value);
                      setPdfFile(null);
                    }}
                    placeholder="Paste MCQs, written questions, or matching blocks here…"
                    rows={7}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      resize: "vertical",
                      fontFamily: "var(--font-mono)",
                      fontSize: 13,
                    }}
                  />
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    margin: "8px 0",
                    color: "var(--color-text-secondary)",
                    fontSize: 12,
                  }}
                >
                  <div
                    style={{
                      flex: 1,
                      height: ".5px",
                      background: "var(--color-border-tertiary)",
                    }}
                  />
                  or
                  <div
                    style={{
                      flex: 1,
                      height: ".5px",
                      background: "var(--color-border-tertiary)",
                    }}
                  />
                </div>
                <div
                  className={`drop-zone${pdfFile ? " drag-over" : ""}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                  onClick={() => fileRef.current?.click()}
                >
                  <i
                    className="ti ti-upload"
                    aria-hidden="true"
                    style={{ fontSize: 20, display: "block", marginBottom: 6 }}
                  ></i>
                  {pdfFile ? (
                    <span
                      style={{
                        color: "var(--color-text-primary)",
                        fontWeight: 500,
                      }}
                    >
                      {pdfFile.name}
                    </span>
                  ) : (
                    <span>
                      Drop a PDF or text file here, or{" "}
                      <span style={{ textDecoration: "underline" }}>
                        browse
                      </span>
                    </span>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.txt"
                  style={{ display: "none" }}
                  onChange={handleFileChange}
                />

                <div style={{ marginTop: 16 }}>
                  <label
                    style={{
                      fontSize: 12,
                      color: "var(--color-text-secondary)",
                      display: "block",
                      marginBottom: 6,
                    }}
                  >
                    Custom Instructions (optional)
                  </label>
                  <input
                    value={customInstructions}
                    onChange={(e) => setCustomInstructions(e.target.value)}
                    placeholder="e.g. Only include the first 50 questions"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      fontSize: 13,
                    }}
                  />
                </div>
              </div>
            )}

            <div className="card" style={{ padding: "1.25rem" }}>
              <p className="section-label">
                {step === "done"
                  ? "Update Classification"
                  : "2 — Classification"}
              </p>

              <div className="field-wrap">
                <label
                  style={{
                    fontSize: 12,
                    color: "var(--color-text-secondary)",
                    display: "block",
                    marginBottom: 4,
                  }}
                >
                  Source <span style={{ color: "#A32D2D" }}>*</span>
                </label>
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  style={{ width: "100%", boxSizing: "border-box" }}
                >
                  <option value="" disabled>
                    Select source…
                  </option>
                  <option value="Exams">Exams</option>
                  <option value="Professor">Professor</option>
                  <option value="Department">Department</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              {source === "Exams" && (
                <div className="field-wrap">
                  <label
                    style={{
                      fontSize: 12,
                      color: "var(--color-text-secondary)",
                      display: "block",
                      marginBottom: 4,
                    }}
                  >
                    Exam type
                  </label>
                  <select
                    value={examType}
                    onChange={(e) => setExamType(e.target.value)}
                    style={{ width: "100%", boxSizing: "border-box" }}
                  >
                    <option value="End">End</option>
                    <option value="Final">Final</option>
                    <option value="Formative">Formative</option>
                    <option value="Booklet">Booklet</option>
                  </select>
                </div>
              )}

              {source === "Professor" && (
                <div className="field-wrap">
                  <label
                    style={{
                      fontSize: 12,
                      color: "var(--color-text-secondary)",
                      display: "block",
                      marginBottom: 4,
                    }}
                  >
                    Professor name (optional)
                  </label>
                  <input
                    value={professorName}
                    onChange={(e) => setProfessorName(e.target.value)}
                    placeholder="e.g. Dr. Smith"
                    style={{ width: "100%", boxSizing: "border-box" }}
                  />
                </div>
              )}

              {source === "Other" && (
                <div className="field-wrap">
                  <label
                    style={{
                      fontSize: 12,
                      color: "var(--color-text-secondary)",
                      display: "block",
                      marginBottom: 4,
                    }}
                  >
                    Custom source name{" "}
                    <span style={{ color: "#A32D2D" }}>*</span>
                  </label>
                  <input
                    value={customSource}
                    onChange={(e) => setCustomSource(e.target.value)}
                    placeholder="e.g. Workshop"
                    style={{ width: "100%", boxSizing: "border-box" }}
                  />
                </div>
              )}

              {computedTag && (
                <div
                  style={{
                    marginBottom: 14,
                    padding: "6px 10px",
                    background: "var(--color-background-secondary)",
                    borderRadius: "var(--border-radius-md)",
                    fontSize: 12,
                    color: "var(--color-text-secondary)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <i
                    className="ti ti-tag"
                    aria-hidden="true"
                    style={{ fontSize: 12 }}
                  ></i>
                  Tag preview:{" "}
                  <span
                    style={{
                      color: "var(--color-text-primary)",
                      fontWeight: 500,
                    }}
                  >
                    {computedTag}
                  </span>
                </div>
              )}

              <div className="field-row-3">
                <div>
                  <label
                    style={{
                      fontSize: 12,
                      color: "var(--color-text-secondary)",
                      display: "block",
                      marginBottom: 4,
                    }}
                  >
                    Year (optional)
                  </label>
                  <input
                    type="number"
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    placeholder="e.g. 2024"
                    style={{ width: "100%", boxSizing: "border-box" }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      fontSize: 12,
                      color: "var(--color-text-secondary)",
                      display: "block",
                      marginBottom: 4,
                    }}
                  >
                    Subject
                  </label>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="e.g. Cardiology"
                    style={{ width: "100%", boxSizing: "border-box" }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      fontSize: 12,
                      color: "var(--color-text-secondary)",
                      display: "block",
                      marginBottom: 4,
                    }}
                  >
                    Lecture
                  </label>
                  <input
                    value={lecture}
                    onChange={(e) => setLecture(e.target.value)}
                    placeholder="e.g. Heart Failure"
                    style={{ width: "100%", boxSizing: "border-box" }}
                  />
                </div>
              </div>
            </div>

            {errorMsg && (
              <div
                style={{
                  padding: "10px 14px",
                  background: "var(--color-background-danger,#FCEBEB)",
                  border: "0.5px solid var(--color-border-danger,#F09595)",
                  borderRadius: "var(--border-radius-md)",
                  fontSize: 13,
                  color: "var(--color-text-danger,#791F1F)",
                }}
              >
                <i
                  className="ti ti-alert-circle"
                  aria-hidden="true"
                  style={{ marginRight: 6 }}
                ></i>
                {errorMsg}
              </div>
            )}

            {step !== "done" && (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  className="action-btn btn-primary"
                  onClick={handleConvert}
                  disabled={!inputReady}
                >
                  <i
                    className="ti ti-sparkles"
                    aria-hidden="true"
                    style={{ fontSize: 15 }}
                  ></i>
                  Extract & convert
                </button>
              </div>
            )}

            {step === "done" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  animation: "fadeIn .3s ease",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <span className="stat-pill">
                    <i
                      className="ti ti-list-check"
                      aria-hidden="true"
                      style={{ fontSize: 13 }}
                    ></i>
                    {questionCount} question{questionCount !== 1 ? "s" : ""}
                  </span>
                  {jsonResult && (
                    <>
                      <span className="stat-pill">
                        <i
                          className="ti ti-square-check"
                          aria-hidden="true"
                          style={{ fontSize: 13 }}
                        ></i>
                        {jsonResult.filter((q) => q.type === "QCS").length} QCS
                      </span>
                      <span className="stat-pill">
                        <i
                          className="ti ti-edit"
                          aria-hidden="true"
                          style={{ fontSize: 13 }}
                        ></i>
                        {jsonResult.filter((q) => q.type === "QROC").length}{" "}
                        QROC
                      </span>
                      {jsonResult.filter((q) => q.cas).length > 0 && (
                        <span className="stat-pill">
                          <i
                            className="ti ti-link"
                            aria-hidden="true"
                            style={{ fontSize: 13 }}
                          ></i>
                          {jsonResult.filter((q) => q.cas).length} with shared
                          context
                        </span>
                      )}
                    </>
                  )}
                </div>

                <div className="card" style={{ padding: "1.25rem" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 12,
                      flexWrap: "wrap",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        gap: 4,
                        background: "var(--color-background-tertiary)",
                        borderRadius: 8,
                        padding: 3,
                      }}
                    >
                      <button
                        className={`tab-btn${activeTab === "csv" ? " active" : ""}`}
                        onClick={() => setActiveTab("csv")}
                      >
                        <i
                          className="ti ti-table"
                          aria-hidden="true"
                          style={{ fontSize: 13, marginRight: 5 }}
                        ></i>
                        CSV
                      </button>
                      <button
                        className={`tab-btn${activeTab === "preview" ? " active" : ""}`}
                        onClick={() => setActiveTab("preview")}
                      >
                        <i
                          className="ti ti-eye"
                          aria-hidden="true"
                          style={{ fontSize: 13, marginRight: 5 }}
                        ></i>
                        Preview
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        className="action-btn btn-ghost"
                        onClick={handleCopy}
                        style={{ fontSize: 12 }}
                      >
                        <i
                          className={`ti ti-${copied ? "check" : "copy"}`}
                          aria-hidden="true"
                          style={{ fontSize: 14 }}
                        ></i>
                        {copied
                          ? "Copied!"
                          : `Copy ${activeTab === "preview" ? "CSV" : activeTab.toUpperCase()}`}
                      </button>
                      <button
                        className="action-btn btn-primary"
                        onClick={handleDownload}
                        style={{ fontSize: 12 }}
                      >
                        <i
                          className="ti ti-download"
                          aria-hidden="true"
                          style={{ fontSize: 14 }}
                        ></i>
                        Download CSV
                      </button>
                    </div>
                  </div>

                  {activeTab === "csv" && (
                    <div className="csv-area">{csvResult}</div>
                  )}

                  {activeTab === "preview" && jsonResult && (
                    <div style={{ maxHeight: 380, overflow: "auto" }}>
                      {jsonResult.map((q, i) => (
                        <div key={i} className="q-row">
                          <div className="q-num">{i + 1}</div>
                          <div style={{ flex: 1 }}>
                            {q.cas && (
                              <p
                                style={{
                                  margin: "0 0 4px",
                                  fontSize: 11,
                                  color: "var(--color-text-secondary)",
                                  fontStyle: "italic",
                                  lineHeight: 1.4,
                                }}
                              >
                                <i
                                  className="ti ti-link"
                                  aria-hidden="true"
                                  style={{ fontSize: 11, marginRight: 3 }}
                                ></i>
                                {q.cas.length > 120
                                  ? q.cas.slice(0, 120) + "…"
                                  : q.cas}
                              </p>
                            )}
                            <p className="q-text" style={{ margin: "0 0 6px" }}>
                              {q.text}
                            </p>
                            {q.options && q.options.length > 0 && (
                              <div
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: 4,
                                  marginBottom: 4,
                                }}
                              >
                                {q.options.map((opt, j) => (
                                  <span
                                    key={j}
                                    style={{
                                      fontSize: 11,
                                      padding: "2px 7px",
                                      borderRadius: 4,
                                      background:
                                        q.correct &&
                                        q.correct
                                          .split(",")
                                          .includes(String.fromCharCode(65 + j))
                                          ? "#EAF3DE"
                                          : "var(--color-background-secondary)",
                                      color:
                                        q.correct &&
                                        q.correct
                                          .split(",")
                                          .includes(String.fromCharCode(65 + j))
                                          ? "#3B6D11"
                                          : "var(--color-text-secondary)",
                                      border:
                                        "0.5px solid var(--color-border-tertiary)",
                                    }}
                                  >
                                    {String.fromCharCode(65 + j)}. {opt}
                                  </span>
                                ))}
                              </div>
                            )}
                            {q.exp && (
                              <p
                                style={{
                                  margin: "4px 0 0",
                                  fontSize: 11,
                                  color: "var(--color-text-secondary)",
                                  lineHeight: 1.5,
                                }}
                              >
                                <i
                                  className="ti ti-info-circle"
                                  aria-hidden="true"
                                  style={{ fontSize: 11, marginRight: 3 }}
                                ></i>
                                {q.exp.length > 160
                                  ? q.exp.slice(0, 160) + "…"
                                  : q.exp}
                              </p>
                            )}
                          </div>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "flex-end",
                              gap: 4,
                              flexShrink: 0,
                            }}
                          >
                            {q.correct && (
                              <span className="q-correct">{q.correct}</span>
                            )}
                            <span
                              className={
                                q.type === "QROC" ? "badge-qroc" : "badge-qcs"
                              }
                            >
                              {q.type || "QCS"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div
                  className="card"
                  style={{
                    padding: "1rem 1.25rem",
                    background: "var(--color-background-secondary)",
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: 12,
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    <i
                      className="ti ti-tag"
                      aria-hidden="true"
                      style={{ marginRight: 5 }}
                    ></i>
                    <strong
                      style={{
                        color: "var(--color-text-primary)",
                        fontWeight: 500,
                      }}
                    >
                      Tag:
                    </strong>{" "}
                    {computedTag || "—"} &nbsp;·&nbsp;
                    <strong
                      style={{
                        color: "var(--color-text-primary)",
                        fontWeight: 500,
                      }}
                    >
                      Subject:
                    </strong>{" "}
                    {subject || "—"} &nbsp;·&nbsp;
                    <strong
                      style={{
                        color: "var(--color-text-primary)",
                        fontWeight: 500,
                      }}
                    >
                      Lecture:
                    </strong>{" "}
                    {lecture || "—"} &nbsp;·&nbsp;
                    <strong
                      style={{
                        color: "var(--color-text-primary)",
                        fontWeight: 500,
                      }}
                    >
                      Year:
                    </strong>{" "}
                    {year || "—"}
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div
            className="card"
            style={{
              padding: "3rem",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
            }}
          >
            <Spinner />
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "var(--color-text-secondary)",
              }}
            >
              {statusMsg}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
