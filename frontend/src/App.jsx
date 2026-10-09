import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import ThreeBackground from "./ThreeBackground";
import "./App.css";
import "./Progress.css";

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

const POLL_MS = 2000;          // how often we ask how indexing is going
const MAX_POLL_FAILURES = 6;   // short network hiccups are tolerated

// Repositories that visitors can load with one click.
// To add more, copy a line and change the name and the link.
const EXAMPLE_REPOS = [
  { label: "YugendharD/devpulse", url: "https://github.com/YugendharD/devpulse" },
  { label: "octocat/Spoon-Knife", url: "https://github.com/octocat/Spoon-Knife" },
  { label: "octocat/Hello-World", url: "https://github.com/octocat/Hello-World" },
  { label: "sindresorhus/slugify", url: "https://github.com/sindresorhus/slugify" },
  { label: "tj/commander.js", url: "https://github.com/tj/commander.js" },
  { label: "psf/requests", url: "https://github.com/psf/requests" },
  { label: "expressjs/express", url: "https://github.com/expressjs/express" },
];

const EXAMPLE_QUESTIONS = [
  "What does this project do?",
  "How is the code structured?",
  "Which technologies does it use?",
  "Where does the app start?",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path, options) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, options);
  } catch {
    throw new Error("Cannot reach the server. Please try again in a moment.");
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    // the server sent something that is not JSON
  }

  if (!response.ok) {
    const detail = data && data.detail;
    const error = new Error(
      typeof detail === "string"
        ? detail
        : "Something went wrong. Please try again."
    );
    error.status = response.status;
    throw error;
  }
  return data;
}

function postJson(path, body) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getJson(path) {
  return request(path);
}

function progressText(progress) {
  if (progress.stage === "Embedding pieces" && progress.total > 0) {
    return `Indexed ${progress.done} of ${progress.total} pieces`;
  }
  if (progress.stage === "Starting") {
    return "Starting... if the server was asleep this can take about a minute";
  }
  return `${progress.stage}...`;
}

function App() {
  const [repoUrl, setRepoUrl] = useState("");
  const [repo, setRepo] = useState(null);
  const [loadingRepo, setLoadingRepo] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [progress, setProgress] = useState(null);

  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(null);

  const bottomRef = useRef(null);
  const tiltRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, asking]);

  // Start indexing in the background and follow its progress.
  // mode "quick" is fast; mode "full" indexes more pieces and is slower.
  // Returns the result when it is finished, or throws an error.
  async function runIndexing(url, mode) {
    setProgress({ stage: "Starting", done: 0, total: 0 });

    try {
      let job = await postJson("/ingest", { repo_url: url, mode });
      let failures = 0;

      while (job.status === "running") {
        setProgress({ stage: job.stage, done: job.done, total: job.total });
        await sleep(POLL_MS);

        try {
          job = await getJson(`/ingest/${job.job_id}`);
          failures = 0;
        } catch (error) {
          // 404 means the server forgot the job. Other problems may be
          // short hiccups, so we try a few more times.
          failures += 1;
          if (error.status === 404 || failures >= MAX_POLL_FAILURES) {
            throw error;
          }
        }
      }

      if (job.status === "error") {
        throw new Error(job.error || "Indexing failed. Please try again.");
      }

      return { ...job.result, url };
    } finally {
      setProgress(null);
    }
  }

  // Load any public GitHub repository (typed or clicked from the examples)
  async function loadRepo(url, mode = "quick") {
    const cleanUrl = url.trim();
    if (!cleanUrl || loadingRepo) return;

    setRepoUrl(cleanUrl);
    setLoadingRepo(true);
    setLoadError("");
    try {
      const result = await runIndexing(cleanUrl, mode);
      setRepo(result);
      setMessages([]);
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoadingRepo(false);
    }
  }

  function handleLoad(event) {
    event.preventDefault();
    loadRepo(repoUrl);
  }

  // Ask a question. If the server forgot the repo (for example after
  // a restart), index it again automatically and retry once.
  async function askWithRecovery(text) {
    const body = { repo_name: repo.repo_name, question: text };
    try {
      return await postJson("/ask", body);
    } catch (error) {
      if (error.message.includes("hasn't been ingested")) {
        await runIndexing(repo.url, repo.mode || "quick");
        return await postJson("/ask", body);
      }
      throw error;
    }
  }

  async function sendQuestion(rawText) {
    const text = rawText.trim();
    if (!text || asking || !repo) return;

    setMessages((prev) => [...prev, { role: "user", text }]);
    setQuestion("");
    setAsking(true);

    try {
      const data = await askWithRecovery(text);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: data.answer, sources: data.sources },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: error.message, isError: true },
      ]);
    } finally {
      setAsking(false);
    }
  }

  function handleAsk(event) {
    event.preventDefault();
    sendQuestion(question);
  }

  async function copyAnswer(text, index) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1500);
    } catch {
      // copying is not allowed in this browser: nothing to do
    }
  }

  // 3D tilt: the chat panel leans toward the mouse
  function handleTilt(event) {
    const element = tiltRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    element.style.transform = `perspective(1000px) rotateX(${(-y * 4).toFixed(
      2
    )}deg) rotateY(${(x * 6).toFixed(2)}deg)`;
  }

  function resetTilt() {
    const element = tiltRef.current;
    if (!element) return;
    element.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg)";
  }

  const hasProgressTotal = progress && progress.total > 0;
  const isQuick = repo && repo.mode === "quick";

  return (
    <>
      <ThreeBackground busy={asking || loadingRepo} />

      <div className="app">
        <header className="header">
          <h1>CodeRAG</h1>
          <p>Paste any public GitHub repository and ask questions about its code.</p>
        </header>

        <form className="row" onSubmit={handleLoad}>
          <input
            type="text"
            placeholder="https://github.com/owner/repo"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
          />
          <button type="submit" disabled={loadingRepo || !repoUrl.trim()}>
            {loadingRepo ? "Indexing..." : "Load repo"}
          </button>
        </form>

        <p className="hint-line">
          Or try an example. A quick index usually takes about 10 seconds, and
          the first load may be slower while the free server wakes up.
        </p>
        <div className="chips">
          {EXAMPLE_REPOS.map((example) => (
            <button
              type="button"
              key={example.url}
              className="chip"
              onClick={() => loadRepo(example.url)}
              disabled={loadingRepo}
            >
              {example.label}
            </button>
          ))}
        </div>

        {progress && (
          <div className="progress" role="status">
            <p className="progress-text">{progressText(progress)}</p>
            <div className="progress-track">
              <div
                className={`progress-fill ${hasProgressTotal ? "" : "indeterminate"}`}
                style={
                  hasProgressTotal
                    ? {
                        width: `${Math.round(
                          (progress.done / progress.total) * 100
                        )}%`,
                      }
                    : undefined
                }
              />
            </div>
          </div>
        )}

        {loadError && <p className="error">{loadError}</p>}

        {repo && !progress && (
          <p className="success">
            Loaded <strong>{repo.repo_name}</strong>: {repo.files_read} files,{" "}
            {repo.chunks_saved} pieces. Ask away!
          </p>
        )}

        {repo && !progress && repo.truncated && (
          <div className="notice">
            <span>
              Large repository: only part of it was indexed ({repo.files_read}{" "}
              of {repo.files_found} readable files). Answers may miss the rest.
            </span>
            {isQuick && (
              <button
                type="button"
                className="notice-btn"
                onClick={() => loadRepo(repo.url, "full")}
                disabled={loadingRepo}
              >
                Index more (about 2 minutes)
              </button>
            )}
          </div>
        )}

        <div
          className="tilt"
          ref={tiltRef}
          onMouseMove={handleTilt}
          onMouseLeave={resetTilt}
        >
          <main className="chat">
            {messages.length === 0 && (
              <div className="empty">
                <p className="hint">
                  {repo
                    ? "Tap a question below, or type your own."
                    : "Load a repository first, then your chat will appear here."}
                </p>

                {repo && (
                  <div className="chips">
                    {EXAMPLE_QUESTIONS.map((example) => (
                      <button
                        type="button"
                        key={example}
                        className="chip"
                        onClick={() => sendQuestion(example)}
                        disabled={asking}
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {messages.map((message, index) => (
              <div
                key={index}
                className={`bubble ${message.role} ${
                  message.isError ? "failed" : ""
                }`}
              >
                {message.role === "assistant" && !message.isError ? (
                  <ReactMarkdown>{message.text}</ReactMarkdown>
                ) : (
                  <p>{message.text}</p>
                )}

                {message.sources && message.sources.length > 0 && (
                  <div className="sources">
                    <span>Sources:</span>
                    {message.sources.map((source) => (
                      <code key={source}>{source}</code>
                    ))}
                  </div>
                )}

                {message.role === "assistant" && !message.isError && (
                  <div className="bubble-tools">
                    <button
                      type="button"
                      className="copy-btn"
                      onClick={() => copyAnswer(message.text, index)}
                    >
                      {copiedIndex === index ? "Copied!" : "Copy"}
                    </button>
                  </div>
                )}
              </div>
            ))}

            {asking && (
              <div className="bubble assistant">
                Thinking<span className="dots" />
              </div>
            )}
            <div ref={bottomRef} />
          </main>
        </div>

        <form className="row" onSubmit={handleAsk}>
          <input
            type="text"
            placeholder={
              repo ? "Ask a question about the code..." : "Load a repo first"
            }
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={!repo}
          />
          <button type="submit" disabled={!repo || asking || !question.trim()}>
            Ask
          </button>
        </form>
      </div>
    </>
  );
}

export default App;