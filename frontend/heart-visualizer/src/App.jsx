import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Center, useGLTF, Html, Bounds } from "@react-three/drei";
import "./App.css";

const API_URL = "http://127.0.0.1:5000";

const vessels = {
  LAD: { color: "#ff5b62", description: "Left Anterior Descending artery", position: [-1.15, -0.45, 0.2] },
  LCX: { color: "#50d890", description: "Left Circumflex artery", position: [1.05, 0.25, 0.2] },
  RCA: { color: "#ffc857", description: "Right Coronary Artery", position: [1.05, -0.65, 0.2] },
};

const riskColors = { HIGH: "#ff5b62", MODERATE: "#ffc857", MEDIUM: "#ffc857", LOW: "#50d890" };
const numericFields = [
  ["Age", "Age", 1, 110], ["Weight", "Weight (kg)", 1, 300], ["Length", "Height / length (cm)", 50, 250],
  ["BMI", "BMI", 5, 80], ["BP", "Blood pressure", 30, 300], ["PR", "Pulse rate", 20, 250],
  ["FBS", "Fasting blood sugar (FBS)", 1, 1000], ["CR", "Creatinine (CR)", 0, 100],
  ["TG", "Triglycerides (TG)", 0, 5000], ["LDL", "LDL cholesterol", 0, 1000], ["HDL", "HDL cholesterol", 0, 500],
  ["BUN", "Blood urea nitrogen (BUN)", 0, 300], ["ESR", "ESR", 0, 300], ["HB", "Hemoglobin (HB)", 0, 30],
  ["K", "Potassium (K)", 0, 20], ["Na", "Sodium (Na)", 50, 250], ["WBC", "White blood cells (WBC)", 0, 300],
  ["Lymph", "Lymphocytes", 0, 100], ["Neut", "Neutrophils", 0, 100], ["PLT", "Platelets (PLT)", 0, 2000],
  ["EF-TTE", "Ejection fraction (EF-TTE)", 0, 100], ["Region RWMA", "Regional wall motion abnormality score", 0, 20],
];
const categoricalFields = [
  ["Sex", "Sex", "sex"], ["DM", "Diabetes mellitus (DM)"], ["HTN", "Hypertension (HTN)"],
  ["Current Smoker", "Current smoker"], ["EX-Smoker", "Former smoker"], ["FH", "Family history of CAD"],
  ["Obesity", "Obesity"], ["CRF", "Chronic renal failure (CRF)"], ["CVA", "Cerebrovascular accident (CVA)"],
  ["Airway disease", "Airway disease"], ["Thyroid Disease", "Thyroid disease"], ["CHF", "Congestive heart failure (CHF)"],
  ["DLP", "Dyslipidemia (DLP)"], ["Edema", "Edema"], ["Weak Peripheral Pulse", "Weak peripheral pulse"],
  ["Lung rales", "Lung rales"], ["Systolic Murmur", "Systolic murmur"], ["Diastolic Murmur", "Diastolic murmur"],
  ["Typical Chest Pain", "Typical chest pain"], ["Dyspnea", "Dyspnea / shortness of breath"],
  ["Function Class", "Functional class"], ["Atypical", "Atypical chest pain"], ["Nonanginal", "Nonanginal pain"],
  ["Exertional CP", "Exertional chest pain"], ["LowTH Ang", "Low-threshold angina"], ["Q Wave", "Q wave"],
  ["St Elevation", "ST elevation"], ["St Depression", "ST depression"], ["Tinversion", "T-wave inversion"],
  ["LVH", "Left ventricular hypertrophy (LVH)"], ["Poor R Progression", "Poor R-wave progression"],
  ["BBB", "Bundle branch block (BBB)"], ["VHD", "Valvular heart disease (VHD)"],
];
const sections = [
  { title: "Personal measurements", description: "Enter known measurements from the patient record.", keys: ["Age", "Weight", "Length", "Sex", "BMI", "BP", "PR"] },
  { title: "Medical history", description: "Choose Yes, No, or Unknown based on available records.", keys: ["DM", "HTN", "Current Smoker", "EX-Smoker", "FH", "Obesity", "CRF", "CVA", "Airway disease", "Thyroid Disease", "CHF", "DLP", "Edema"] },
  { title: "Symptoms and examination", description: "Only enter findings documented by a qualified clinician.", keys: ["Weak Peripheral Pulse", "Lung rales", "Systolic Murmur", "Diastolic Murmur", "Typical Chest Pain", "Dyspnea", "Function Class", "Atypical", "Nonanginal", "Exertional CP", "LowTH Ang", "Q Wave", "St Elevation", "St Depression", "Tinversion", "LVH", "Poor R Progression", "BBB", "VHD"] },
  { title: "Laboratory and imaging values", description: "Leave fields blank if the value is not available; missing values may affect predictions.", keys: ["FBS", "CR", "TG", "LDL", "HDL", "BUN", "ESR", "HB", "K", "Na", "WBC", "Lymph", "Neut", "PLT", "EF-TTE", "Region RWMA"] },
];
const numericMap = Object.fromEntries(numericFields.map(([key, label, min, max]) => [key, { label, min, max }]));
const categoricalMap = Object.fromEntries(categoricalFields.map(([key, label, kind]) => [key, { label, kind }]));
const allKeys = [...numericFields.map(x => x[0]), ...categoricalFields.map(x => x[0])];

function HeartModel({ displayVessels }) {
  const { scene } = useGLTF("/models/heart_clear.glb");
  const heartScene = useMemo(() => scene.clone(true), [scene]);
  useEffect(() => {
    heartScene.traverse((obj) => {
      if (!obj.isMesh || !Object.prototype.hasOwnProperty.call(vessels, obj.name)) return;
      const info = displayVessels[obj.name];
      if (!obj.userData.originalVesselColor) obj.userData.originalVesselColor = obj.material?.color?.getHexString ? `#${obj.material.color.getHexString()}` : vessels[obj.name].color;
      if (!obj.userData.clonedMaterial) {
        obj.material = Array.isArray(obj.material) ? obj.material.map(m => m.clone()) : obj.material.clone();
        obj.userData.clonedMaterial = true;
      }
      const color = info?.risk && info.risk !== "Unavailable" ? (riskColors[info.risk] || obj.userData.originalVesselColor) : obj.userData.originalVesselColor;
      (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(m => { if (m.color) m.color.set(color); });
    });
  }, [heartScene, displayVessels.LAD?.risk, displayVessels.LCX?.risk, displayVessels.RCA?.risk]);
  return <Bounds fit clip observe margin={1.35}><Center><primitive object={heartScene} /></Center></Bounds>;
}

function HeroHeartModel() {
  const { scene } = useGLTF("/models/heart_clear.glb");
  const heart = useMemo(() => scene.clone(true), [scene]);
  const groupRef = useRef();

  useFrame((state) => {
    if (!groupRef.current) return;
    const time = state.clock.elapsedTime;
    // A short, gentle contraction followed by a relaxed release.
    const beat = Math.pow(Math.max(0, Math.sin(time * Math.PI * 2 * 1.15)), 10);
    const scale = 1 + beat * 0.045;
    groupRef.current.scale.setScalar(scale);
    groupRef.current.rotation.y = Math.sin(time * 0.45) * 0.07;
  });

  return (
    <group ref={groupRef}>
      <Bounds fit clip observe margin={1.3}>
        <Center><primitive object={heart} /></Center>
      </Bounds>
    </group>
  );
}

function HeartTag({ name, data, selected, onSelect }) {
  return <Html position={data.position} center distanceFactor={7} style={{ pointerEvents: "auto" }}>
    <button className={`heart-tag ${selected ? "active" : ""}`} style={{ "--tag-color": data.color }} onClick={e => { e.stopPropagation(); onSelect(name); }}>
      <span>{name}</span><strong>{data.probability == null ? "--" : `${data.probability.toFixed(1)}%`}</strong>
    </button>
  </Html>;
}

function App() {
  const [page, setPage] = useState("home");
  const [authMode, setAuthMode] = useState("login");
  const [user, setUser] = useState(null);
  const [auth, setAuth] = useState({ name: "", email: "", password: "" });
  const [form, setForm] = useState({});
  const [formSection, setFormSection] = useState(0);
  const [predictions, setPredictions] = useState(null);
  const [selected, setSelected] = useState("LAD");
  const [apiStatus, setApiStatus] = useState("Checking API");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const controlsRef = useRef();

  useEffect(() => {
    let live = true;
    fetch(`${API_URL}/api/health`).then(r => { if (!r.ok) throw new Error("API unavailable"); return r.json(); })
      .then(data => { if (live) setApiStatus(data.status === "ok" ? "API connected" : "API unavailable"); })
      .catch(() => { if (live) setApiStatus("API offline"); });
    return () => { live = false; };
  }, []);

  const displayVessels = Object.fromEntries(Object.entries(vessels).map(([name, meta]) => {
    const result = predictions?.[name];
    const risk = result?.risk || "Unavailable";
    return [name, { ...meta, risk, probability: typeof result?.probability === "number" ? result.probability * 100 : null, color: riskColors[risk] || meta.color }];
  }));
  const activeVessel = displayVessels[selected];
  const cad = predictions?.CAD;

  function updateField(key, value) { setForm(prev => ({ ...prev, [key]: value })); }
  function signIn(e) {
    e.preventDefault();
    if (!auth.email.trim() || !auth.password) return;
    // Prototype-only identity: this is not secure server-side authentication.
    const displayName = authMode === "signup" ? auth.name.trim() : auth.email.split("@")[0];
    if (authMode === "signup" && !displayName) return;
    setUser({ name: displayName, email: auth.email.trim() });
    setPage("assessment");
    setError("");
  }
  function logout() { setUser(null); setPage("home"); setPredictions(null); setForm({}); setAuth({ name: "", email: "", password: "" }); }

  async function submitAssessment(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const payload = {};
    for (const key of allKeys) {
      const value = form[key];
      if (value === undefined || value === "") continue;
      if (key === "Sex") {
        payload[key] = value;
      } else if (categoricalMap[key]) {
        payload[key] = value;
      } else {
        const n = Number(value);
        if (Number.isFinite(n)) payload[key] = n;
      }
    }
    try {
      const response = await fetch(`${API_URL}/api/predict`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Prediction request failed.");
      setPredictions(data);
      setPage("results");
    } catch (err) {
      setError(`${err.message}. Check that the Python API is running at ${API_URL}.`);
    } finally { setLoading(false); }
  }

  function downloadReport() {
    const date = new Date().toLocaleString();
    const rows = [
      "CARDIOVISION AI — MODEL OUTPUT REPORT", `Generated: ${date}`,
      `User: ${user?.name || "Demo user"}`, `Email: ${user?.email || "Not provided"}`, "",
      "IMPORTANT: Research/demo output only. Not a clinical diagnosis.", "",
      ...["CAD", "LAD", "LCX", "RCA"].map(key => {
        const item = predictions?.[key];
        return `${key}: ${item ? `${(item.probability * 100).toFixed(2)}% model-predicted probability | Risk band: ${item.risk}` : "Unavailable"}`;
      }),
      "", `Missing input fields: ${(predictions?.missing_inputs || []).join(", ") || "None reported"}`,
      "", "Probabilities are model outputs, not measured blockage percentages. Do not use this report alone for medical decisions."
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "CardioVision-Assessment-Report.txt"; link.click();
    URL.revokeObjectURL(url);
  }

  return <div className="site-shell">
    <header className="topbar">
      <button className="brand" onClick={() => setPage("home")} aria-label="CardioVision home">
        <span className="brand-mark">♥</span><span><b>CardioVision<span className="accent"> AI</span></b><small>Cardiovascular insight platform</small></span>
      </button>
      <nav className="topnav">
        <button onClick={() => setPage("home")}>Overview</button>
        {page === "home" && <>
          <button onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })}>How it works</button>
          <button onClick={() => document.getElementById("why-cardio")?.scrollIntoView({ behavior: "smooth" })}>Why us</button>
        </>}
        {user && <button onClick={() => setPage("assessment")}>Assessment</button>}
        {user ? <button className="nav-cta" onClick={logout}>Sign out</button> : <button className="nav-cta" onClick={() => { setAuthMode("login"); setPage("auth"); }}>Log in <span>↗</span></button>}
      </nav>
    </header>

    {page === "home" && <main>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="live-dot" /> ML-POWERED CARDIOVASCULAR RESEARCH</div>
          <h1>See the heart.<br /><span className="accent">Understand the signals.</span></h1>
          <p className="hero-lead">Explore a model-assisted view of coronary artery risk using patient health information and an interactive 3D heart.</p>
          <div className="hero-actions"><button className="primary-btn" onClick={() => { setAuthMode("signup"); setPage("auth"); }}> Testing<span>→</span></button><button className="text-btn" onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })}>Explore how it works ↓</button></div>
          <div className="hero-proof"><span>01 / Health profile</span><i /><span>02 / Model analysis</span><i /><span>03 / Visual results</span></div>
        </div>
        <div className="hero-art">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="hero-heart-stage" aria-label="Animated 3D heart model">
            <Canvas camera={{ position: [0, 0, 5], fov: 40 }} dpr={[1, 1.5]} gl={{ alpha: true, antialias: true }}>
              <ambientLight intensity={1.8} />
              <directionalLight position={[4, 5, 5]} intensity={2.5} color="#fff0f0" />
              <pointLight position={[-3, 1, 3]} intensity={18} color="#ff6269" />
              <HeroHeartModel />
            </Canvas>
          </div>
          <div className="art-chip chip-top"><span className="live-dot" /> 3D HEART VIEW</div>
          <div className="art-chip chip-bottom"><span className="chip-line" /> CAD · LAD · LCX · RCA</div>
          <div className="art-caption">VISUALIZE WHAT MATTERS</div>
        </div>
      </section>

      <section className="stats-strip">
        <div><span className="stat-index">01</span><b>Patient-first input</b><small>Organized health information</small></div>
        <div><span className="stat-index">02</span><b>Model-assisted output</b><small>Probability and risk bands</small></div>
        <div><span className="stat-index">03</span><b>Interactive anatomy</b><small>Explore three coronary arteries</small></div>
      </section>

      <section id="how-it-works" className="content-section">
        <div className="section-kicker">THE PROCESS</div><h2>From health details to a clearer view.</h2><p className="section-intro">A guided workflow designed to make the model's output easier to explore—not to replace a clinician.</p>
        <div className="step-grid">
          <article className="step-card"><span className="step-no">01</span><div className="step-icon">↗</div><h3>Create your session</h3><p>Enter through the prototype login and begin a structured health assessment.</p></article>
          <article className="step-card"><span className="step-no">02</span><div className="step-icon">⌁</div><h3>Review health inputs</h3><p>Provide available measurements, history, symptoms, lab values and examination findings.</p></article>
          <article className="step-card"><span className="step-no">03</span><div className="step-icon">♡</div><h3>Explore model output</h3><p>View CAD and artery-specific predictions, inspect the 3D model, and download a report.</p></article>
        </div>
      </section>

      <section id="why-cardio" className="why-section"><div><div className="section-kicker">WHY CARDIOVISION</div><h2>Make complex outputs<br />easier to explore.</h2></div><div className="why-points"><div><b>Structured, guided flow</b><p>Separate the health form from results so users can focus on one step at a time.</p></div><div><b>Visual context</b><p>Use the 3D heart to explore LAD, LCX and RCA model outputs in one place.</p></div><div><b>Portable summary</b><p>Export a simple text report with model outputs, timestamp and missing-input notes.</p></div></div></section>
      <section className="safety-banner"><span className="safety-icon">i</span><div><b>Research and demonstration tool</b><p>Predictions are generated by a machine-learning model and are not a diagnosis, a measured blockage percentage, or a substitute for medical advice. Do not enter real patient-identifying information into this prototype.</p></div></section>
    </main>}

    {page === "auth" && <main className="auth-page">
      <div className="auth-visual"><div className="section-kicker">YOUR CARDIOVISION SESSION</div><h2>Better context.<br /><span className="accent">One step at a time.</span></h2><p>Start with available health information, then explore the model output and 3D visualization.</p><div className="auth-visual-heart">♥</div><div className="auth-visual-note">MODEL-ASSISTED · RESEARCH DEMO</div></div>
      <form className="auth-card" onSubmit={signIn}>
        <div className="section-kicker">{authMode === "login" ? "WELCOME BACK" : "GET STARTED"}</div><h1>{authMode === "login" ? "Log in" : "Create an account"}</h1><p className="muted">This is a front-end prototype session, not secure account authentication.</p>
        {authMode === "signup" && <label>Display name<input required value={auth.name} onChange={e => setAuth({ ...auth, name: e.target.value })} placeholder="Your name" /></label>}
        <label>Email address<input required type="email" value={auth.email} onChange={e => setAuth({ ...auth, email: e.target.value })} placeholder="you@example.com" /></label>
        <label>Password<input required type="password" minLength="4" value={auth.password} onChange={e => setAuth({ ...auth, password: e.target.value })} placeholder="Enter any demo password" /></label>
        <button className="primary-btn full-btn" type="submit">{authMode === "login" ? "Continue to assessment" : "Create demo session"} <span>→</span></button>
        <p className="auth-switch">{authMode === "login" ? "New to CardioVision?" : "Already have a session?"} <button type="button" onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")}>{authMode === "login" ? "Sign up" : "Log in"}</button></p>
        <p className="auth-note">Demo only: no password is sent to or verified by a server.</p>
      </form>
    </main>}

    {page === "assessment" && <main className="form-page">
      <div className="page-heading"><div><div className="section-kicker">PATIENT HEALTH PROFILE</div><h1>Health assessment</h1><p className="muted">Enter values from an available health record. Unknown values can be left blank.</p></div><span className="step-pill">STEP 1 OF 2</span></div>
      <div className="progress-steps"><span className="current">01 <b>Health details</b></span><i /><span>02 <b>3D results</b></span></div>
      <form className="assessment-form" onSubmit={submitAssessment}>
        {sections.map((section, idx) => <section className="form-section" key={section.title}>
          <div className="form-section-heading"><span className="section-number">0{idx + 1}</span><div><h2>{section.title}</h2><p>{section.description}</p></div></div>
          <div className="field-grid">{section.keys.map(key => {
            const numeric = numericMap[key]; const categorical = categoricalMap[key];
            return <label className="field" key={key}><span>{numeric?.label || categorical?.label || key}</span>
              {numeric ? <input type="number" min={numeric.min} max={numeric.max} step="any" value={form[key] ?? ""} onChange={e => updateField(key, e.target.value)} placeholder="Leave blank if unknown" />
              : <select value={form[key] ?? ""} onChange={e => updateField(key, e.target.value)}><option value="">Unknown / not recorded</option>{(categorical?.kind === "sex" ? ["Female", "Male"] : key === "Function Class" ? ["I", "II", "III", "IV"] : ["No", "Yes"]).map(v => <option key={v} value={v}>{v}</option>)}</select>}
            </label>;
          })}</div>
        </section>)}
        {error && <div className="error-box" role="alert">{error}</div>}
        <div className="form-actions"><button type="button" className="secondary-btn" onClick={() => setPage("home")}>Cancel</button><button className="primary-btn" type="submit" disabled={loading}>{loading ? "Analyzing…" : "Generate model output"} <span>→</span></button></div>
        <p className="form-disclaimer">Only submit information you are authorized to use. This prototype does not securely store patient records. Model outputs are not medical advice.</p>
      </form>
    </main>}

    {page === "results" && <main className="results-page">
      <div className="page-heading results-heading"><div><div className="section-kicker">ASSESSMENT COMPLETE</div><h1>Your model results</h1><p className="muted">Explore the output returned by the trained model.</p></div><div className="result-actions"><button className="secondary-btn" onClick={() => setPage("assessment")}>Edit inputs</button><button className="primary-btn" onClick={downloadReport}>↓ Download report</button></div></div>
      <div className="result-summary"><div><span className="summary-label">OVERALL CAD MODEL OUTPUT</span><strong>{cad ? `${(cad.probability * 100).toFixed(2)}%` : "Unavailable"}</strong><span className="summary-band" style={{ color: riskColors[cad?.risk] || "#a3aab8" }}>{cad?.risk || "No result"} risk band</span></div><p>This is a model-predicted probability, not a confirmed diagnosis or measured arterial blockage.</p></div>
      {predictions?.missing_inputs?.length > 0 && <div className="warning-box"><b>Some model inputs were missing</b><p>{predictions.missing_inputs.join(", ")}</p><small>Check the assessment record. The model may have handled missing fields internally.</small></div>}
      <div className="results-grid">
        <section className="heart-panel"><div className="panel-title"><div><div className="section-kicker">ANATOMY EXPLORER</div><h2>Interactive 3D heart</h2><p>Drag to rotate · Scroll to zoom · Select an artery</p></div><button className="icon-btn" onClick={() => controlsRef.current?.reset()}>↻ Reset</button></div>
          <div className="heart-canvas"><Canvas camera={{ position: [0, 0, 6], fov: 40 }} dpr={[1, 1.5]}><color attach="background" args={["#0d1421"]} /><ambientLight intensity={1.8} /><directionalLight position={[5, 6, 5]} intensity={2.2} /><directionalLight position={[-5, 2, -5]} intensity={1.2} /><HeartModel displayVessels={displayVessels} />{Object.entries(displayVessels).map(([name, data]) => <HeartTag key={name} name={name} data={data} selected={selected === name} onSelect={setSelected} />)}<OrbitControls ref={controlsRef} makeDefault enablePan={false} minDistance={2} maxDistance={12} rotateSpeed={0.8} /></Canvas></div>
          <div className="artery-tabs">{Object.entries(displayVessels).map(([name, data]) => <button key={name} className={selected === name ? "artery-tab active" : "artery-tab"} onClick={() => setSelected(name)}><i style={{ background: data.color }} />{name}<b>{data.probability == null ? "--" : `${data.probability.toFixed(1)}%`}</b></button>)}</div>
          <div className="risk-key"><span><i style={{ background: "#50d890" }} />LOW</span><span><i style={{ background: "#ffc857" }} />MODERATE</span><span><i style={{ background: "#ff5b62" }} />HIGH</span></div>
        </section>
        <aside className="result-side"><section className="result-card"><div className="section-kicker">SELECTED ARTERY</div><h2>{selected}</h2><p>{activeVessel.description}</p><div className="big-prob" style={{ color: activeVessel.color }}>{activeVessel.probability == null ? "--" : `${activeVessel.probability.toFixed(2)}%`}</div><span className="risk-badge" style={{ color: riskColors[activeVessel.risk] || "#a3aab8", borderColor: riskColors[activeVessel.risk] || "#434b5b" }}>{activeVessel.risk}</span><div className="prob-track"><span style={{ width: `${Math.max(0, Math.min(100, activeVessel.probability ?? 0))}%`, background: activeVessel.color }} /></div><small>Model-predicted probability</small></section>
          {["LAD", "LCX", "RCA"].map(name => <button key={name} className={`mini-result ${selected === name ? "chosen" : ""}`} onClick={() => setSelected(name)}><i style={{ background: displayVessels[name].color }} /><span><b>{name}</b><small>{displayVessels[name].description}</small></span><strong>{displayVessels[name].probability == null ? "--" : `${displayVessels[name].probability.toFixed(1)}%`}</strong></button>)}
          <button className="primary-btn full-btn" onClick={downloadReport}>↓ Download Test report</button>
        </aside>
      </div>
      <section className="report-note"><b>How to read these results</b><p>Risk bands are the model's categories. Probabilities are not measured blockage percentages, and this visualization does not establish stenosis. A qualified healthcare professional must interpret health information and any clinical tests.</p></section>
      <div className="form-actions"><button className="secondary-btn" onClick={() => setPage("assessment")}>← Back to health details</button><button className="primary-btn" onClick={() => { setPredictions(null); setForm({}); setPage("assessment"); }}>Test again! →</button></div>
    </main>}

    <footer className="footer"><span>♥ CARDIOVISION AI</span><span>Research prototype · Not for clinical decision-making</span><span>{apiStatus}</span></footer>
  </div>;
}

useGLTF.preload("/models/heart_clear.glb");
export default App;
