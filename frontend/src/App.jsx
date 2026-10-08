import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import ThreeBackground from "./ThreeBackground";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

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

async function postJson(path, body) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
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
    throw new Error(
      typeof detail === "string"
        ? detail
        : "Something went wrong. Please try again."
    );
  }
  return data;
}

function App() {
  const [repoUrl, setRepoUrl] = useState("");
  const [repo, setRepo] = useState(null);
  const [loadingRepo, setLoadingRepo] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(null);

  const bottomRef = useRef(null);
  const tiltRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, asking]);

  // Load any public GitHub repository (typed or clicked from the examples)
  async function loadRepo(url) {
    const cleanUrl = url.trim();
    if (!cleanUrl || loadingRepo) return;

    setRepoUrl(cleanUrl);
    setLoadingRepo(true);
    setLoadError("");
    try {
      const data = await postJson("/ingest", { repo_url: cleanUrl });
      setRepo({ ...data, url: cleanUrl });
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
  // a restart), load it again automatically and retry once.
  async function askWithRecovery(text) {
    const body = { repo_name: repo.repo_name, question: text };
    try {
      return await postJson("/ask", body);
    } catch (error) {
      if (error.message.includes("hasn't been ingested")) {
        await postJson("/ingest", { repo_url: repo.url });
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
            {loadingRepo ? "Reading repo..." : "Load repo"}
          </button>
        </form>

        <p className="hint-line">
          Or try an example. The first load can take about a minute while the
          free server wakes up.
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

        {loadError && <p className="error">{loadError}</p>}

        {repo && (
          <p className="success">
            Loaded <strong>{repo.repo_name}</strong>: {repo.files_read} files,{" "}
            {repo.chunks_saved} pieces. Ask away!
          </p>
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