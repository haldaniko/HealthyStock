import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { apiUrl, assetUrl, getHealthIndex, getPostBySlug, getPosts, subscribe } from "./api";
import { trackPageView } from "./analytics";
import type { AdminSettings, BlogPost, HealthIndex } from "./domain";

type DraftPost = Omit<BlogPost, "secondaryKeywords"> & { secondaryKeywords: string };
type AdminView = "articles" | "generation";
type PendingAction = "auth" | "sync" | "save-post" | "delete-post" | "save-settings" | "generate" | "upload-media" | "delete-media" | null;
type StatusTone = "success" | "error" | "info";

type MediaAsset = {
  name: string;
  url: string;
  size: number;
  createdAt: string;
};

const emptyDraft: DraftPost = {
  id: "",
  title: "",
  slug: "",
  excerpt: "",
  content: "",
  coverImage: "",
  author: "Maria Iordanova",
  publishedAt: new Date().toISOString().slice(0, 10),
  readTimeMinutes: 6,
  primaryKeyword: "",
  secondaryKeywords: "",
  category: "Admin",
  rating: "B",
  status: "published"
};

const coverPool = [
  "/covers/cover1.png",
  "/covers/cover2.png",
  "/covers/cover3.png",
  "/covers/cover4.png"
];

function navigate(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new Event("app:navigate"));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function SocialIcon({ name }: { name: "x" | "threads" | "telegram" | "linkedin" }) {
  if (name === "x") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18.244 2H21.5l-7.11 8.126L22.75 22h-6.54l-5.12-6.693L5.23 22H1.97l7.605-8.692L1.55 2h6.705l4.627 6.118L18.244 2Zm-1.143 17.91h1.804L7.27 3.98H5.334L17.1 19.91Z" />
      </svg>
    );
  }
  if (name === "threads") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12.08 2C7.02 2 4 5.36 4 10.93v2.14C4 18.64 7.02 22 12.08 22c4.38 0 7.13-2.28 7.13-5.86 0-2.58-1.48-4.2-4.2-4.82-.16-2.32-1.53-3.77-3.88-3.77-1.5 0-2.76.52-3.73 1.55l1.22 1.42c.67-.7 1.46-1.05 2.37-1.05 1.1 0 1.78.62 1.94 1.74h-1.44c-2.72 0-4.41 1.3-4.41 3.38 0 2 1.55 3.3 3.94 3.3 2.35 0 3.82-1.2 4.14-3.45 1.26.45 1.9 1.24 1.9 2.37 0 2.02-1.88 3.29-4.88 3.29-3.82 0-5.99-2.48-5.99-6.9v-2.24c0-4.42 2.17-6.9 5.99-6.9 2.98 0 4.84 1.38 5.28 3.9h2.1C19.03 4.43 16.32 2 12.08 2Zm-1 13.96c-1.13 0-1.82-.52-1.82-1.36 0-.92.83-1.46 2.27-1.46h1.48c-.17 1.84-.83 2.82-1.93 2.82Z" />
      </svg>
    );
  }
  if (name === "telegram") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21.74 4.67 18.5 19.95c-.24 1.08-.88 1.34-1.78.84l-4.92-3.63-2.37 2.28c-.26.26-.48.48-.98.48l.35-5.02 9.13-8.25c.4-.35-.09-.55-.62-.2L6.03 13.56 1.17 12.04c-1.05-.33-1.07-1.05.22-1.55L20.4 3.16c.88-.33 1.65.2 1.34 1.51Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.98 3.5C4.98 4.88 3.86 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5ZM.33 8h4.33v14H.33V8Zm7 0h4.15v1.92h.06c.58-1.1 2-2.25 4.1-2.25 4.38 0 5.19 2.88 5.19 6.63V22H16.5v-6.82c0-1.63-.03-3.72-2.27-3.72-2.27 0-2.62 1.77-2.62 3.6V22H7.33V8Z" />
    </svg>
  );
}

function ShareBar({ title, url }: { title: string; url: string }) {
  const absoluteUrl = typeof window !== "undefined" ? new URL(url, window.location.origin).href : url;
  const shareText = `${title} ${absoluteUrl}`;
  const encodedUrl = encodeURIComponent(absoluteUrl);
  const encodedTitle = encodeURIComponent(title);
  const encodedShareText = encodeURIComponent(shareText);
  const targets = [
    { label: "X", icon: "x" as const, href: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}` },
    { label: "Threads", icon: "threads" as const, href: `https://www.threads.net/intent/post?text=${encodedShareText}` },
    { label: "Telegram", icon: "telegram" as const, href: `https://t.me/share/url?url=${encodedUrl}&text=${encodedTitle}` },
    { label: "LinkedIn", icon: "linkedin" as const, href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}` },
  ];

  return (
    <aside className="share-bar" aria-label="Share this post">
      <span className="share-label">Share this post</span>
      <div className="share-actions">
        {targets.map((target) => (
          <a key={target.label} className="share-link" href={target.href} target="_blank" rel="noreferrer" aria-label={`Share on ${target.label}`}>
            <SocialIcon name={target.icon} />
            <span>{target.label}</span>
          </a>
        ))}
      </div>
    </aside>
  );
}


function getStableCover(post: BlogPost) {
  if (post.coverImage) return post.coverImage.startsWith("/uploads/") ? assetUrl(post.coverImage) : post.coverImage;
  let hash = 0;
  for (const char of post.slug) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return coverPool[hash % coverPool.length];
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
}

function getCookie(name: string): string | null {
  const prefix = `${name}=`;
  const cookie = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
}

function Header() {
  return (
    <header className="site-header">
      <div className="container header-inner">
        <button className="logo logo-button" onClick={() => navigate("/")}>
          Healthy<span>Stock</span>
        </button>
        <nav className="site-nav">
          <button onClick={() => navigate("/blog")}>Blog</button>
        </nav>
        <div className="tagline">Food ratings, blood sugar notes, practical health signals</div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        HealthyStock publishes educational nutrition content. It is not medical advice.
      </div>
    </footer>
  );
}

function MedicalDisclaimer() {
  return (
    <aside className="medical-disclaimer">
      <strong>Educational content only</strong>
      <p>
        This article is not medical advice, diagnosis, or treatment. If you have a health condition,
        take medication, are pregnant, or plan major diet changes, speak with your doctor or qualified clinician.
      </p>
    </aside>
  );
}

function Newsletter() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      setMessage(await subscribe(email));
      setEmail("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Subscription failed");
    }
  }

  return (
    <section className="newsletter container">
      <h2>Get the weekly food signal</h2>
      <p>Short practical notes on nutrition, product ratings, and healthy defaults.</p>
      <form onSubmit={submit}>
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
        <button type="submit">Subscribe</button>
      </form>
      {message ? <p className="status">{message}</p> : null}
    </section>
  );
}

function PostCard({ post }: { post: BlogPost }) {
  return (
    <article className="post-card" role="link" tabIndex={0} onClick={() => navigate(`/blog/${post.slug}`)} onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        navigate(`/blog/${post.slug}`);
      }
    }}>
      <img src={getStableCover(post)} alt="" />
      <div className="post-card-content">
        <div className="meta">
          <span>{post.category}</span>
          <span>{post.rating}</span>
          <span>{post.readTimeMinutes} min</span>
        </div>
        <h3>{post.title}</h3>
        <p>{post.excerpt}</p>
        <button className="read-link">Read analysis</button>
      </div>
    </article>
  );
}

function SearchAndFeed({ posts }: { posts: BlogPost[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return posts;
    return posts.filter((post) =>
      [post.title, post.excerpt, post.primaryKeyword, post.category, ...post.secondaryKeywords]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [posts, query]);

  return (
    <section className="feed container">
      <div className="feed-head">
        <div>
          <h2>Latest health stock reports</h2>
          <p>Food decisions scored for everyday energy, fiber, and metabolic steadiness.</p>
        </div>
        <label className="search-bar">
          <span>Search</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="chia, protein, blood sugar..." />
        </label>
      </div>
      <div className="posts-grid">
        {filtered.map((post) => <PostCard key={post.slug} post={post} />)}
      </div>
    </section>
  );
}

function HomePage({ posts, healthIndex }: { posts: BlogPost[]; healthIndex: HealthIndex | null }) {
  return (
    <>
      <section className="hero">
        <div className="hero-glow" />
        <div className="container hero-grid">
          <div className="hero-copy">
            <div className="hero-kicker">Food intelligence for everyday decisions</div>
            <h1>Healthier defaults, scored like a stock watchlist.</h1>
            <p>
              HealthyStock turns nutrition research into readable food ratings, risk notes, and
              practical swaps for busy people who want better daily choices.
            </p>
            <div className="hero-actions">
              <button className="btn btn-primary" onClick={() => navigate("/blog")}>Read the blog</button>
              <button className="btn" onClick={() => navigate("/blog")}>Browse ratings</button>
            </div>
          </div>
          <aside className="hero-card">
            <h2>Live Health Index</h2>
            <ul>
              {(healthIndex?.metrics ?? []).slice(0, 3).map((metric) => (
                <li key={metric.label}>
                  <span>{metric.label}</span>
                  <strong>{metric.value} / 100</strong>
                </li>
              ))}
            </ul>
            <p><em>Signal:</em> {healthIndex?.signal ?? "Shift breakfast portfolio toward protein + fiber."}</p>
            <small>Educational signal, not medical advice.</small>
          </aside>
        </div>
      </section>
      <Ticker items={healthIndex?.tickerItems ?? []} />
      <SearchAndFeed posts={posts} />
      <Newsletter />
    </>
  );
}

function Ticker({ items }: { items: string[] }) {
  const content = items.length ? items : ["Protein + fiber improves breakfast stability", "Ultra-processed snacks remain a downside risk"];
  return (
    <div className="ticker">
      <div className="ticker-track">
        {[...content, ...content].map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}
      </div>
    </div>
  );
}

function BlogPage({ posts }: { posts: BlogPost[] }) {
  return (
    <>
      <section className="blog-index-hero">
        <div className="container blog-index-hero-inner">
          <div>
            <div className="hero-kicker">HealthyStock archive</div>
            <h1>Food ratings and practical nutrition notes.</h1>
            <p>Search the archive for product signals, breakfast swaps, fiber ideas, and blood sugar-friendly choices.</p>
          </div>
          <aside className="blog-index-panel">
            <span>Editorial rule</span>
            <strong>Useful, cautious, practical.</strong>
            <p>No medical promises, no hype. Just clear food analysis.</p>
          </aside>
        </div>
      </section>
      <SearchAndFeed posts={posts} />
    </>
  );
}

function ArticlePage({ post }: { post?: BlogPost | null }) {
  if (!post) {
    return (
      <main className="container article-page">
        <p className="breadcrumb">404</p>
        <h1>Article not found</h1>
        <button className="btn btn-primary" onClick={() => navigate("/blog")}>Back to blog</button>
      </main>
    );
  }

  return (
    <main className="container article-page">
      <button className="breadcrumb link-button" onClick={() => navigate("/blog")}>Back to blog</button>
      <h1>{post.title}</h1>
      <p className="article-meta">
        {post.author} · {post.publishedAt} · {post.readTimeMinutes} min · Rating {post.rating}
      </p>
      <img className="article-cover" src={getStableCover(post)} alt="" />
      <MedicalDisclaimer />
      <ShareBar title={post.title} url={`/blog/${post.slug}`} />
      <section dangerouslySetInnerHTML={{ __html: post.content }} />
    </main>
  );
}

function AdminPanel() {
  const [accessToken, setAccessToken] = useState("");
  const [csrfToken, setCsrfToken] = useState("");
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [coverImages, setCoverImages] = useState<MediaAsset[]>([]);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [draft, setDraft] = useState<DraftPost>(emptyDraft);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [credentials, setCredentials] = useState({ login: "", password: "" });
  const [activePanel, setActivePanel] = useState<AdminView>("articles");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "published">("all");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [status, setStatus] = useState<{ tone: StatusTone; text: string } | null>(null);

  const isEditing = Boolean(selectedSlug);
  const isBusy = pendingAction !== null;

  useEffect(() => {
    refreshAccessToken().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (accessToken) {
      Promise.all([loadPosts(accessToken), loadSettings(accessToken), loadMedia(accessToken)]).catch((error) => {
        setStatus({ tone: "error", text: error instanceof Error ? error.message : "Failed to load admin data" });
      });
    }
  }, [accessToken]);

  const sortedPosts = useMemo(() => [...posts].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)), [posts]);
  const filteredPosts = useMemo(() => {
    return sortedPosts.filter((post) => {
      const normalizedStatus = post.status ?? "published";
      const passesStatus = statusFilter === "all" || normalizedStatus === statusFilter;
      const haystack = `${post.title} ${post.slug} ${post.primaryKeyword} ${post.category}`.toLowerCase();
      const passesSearch = search.trim().length === 0 || haystack.includes(search.trim().toLowerCase());
      return passesStatus && passesSearch;
    });
  }, [search, sortedPosts, statusFilter]);

  const stats = useMemo(() => {
    const draftCount = posts.filter((post) => (post.status ?? "published") === "draft").length;
    return { total: posts.length, drafts: draftCount, published: posts.length - draftCount };
  }, [posts]);

  function setSuccess(text: string) { setStatus({ tone: "success", text }); }
  function setError(text: string) { setStatus({ tone: "error", text }); }
  function setInfo(text: string) { setStatus({ tone: "info", text }); }
  function createNewDraft(): DraftPost { return { ...emptyDraft, publishedAt: new Date().toISOString().slice(0, 10) }; }
  function toDraftPost(post: BlogPost): DraftPost { return { ...post, coverImage: post.coverImage ?? "", secondaryKeywords: post.secondaryKeywords.join(", ") }; }
  function toPostPayload(currentDraft: DraftPost) {
    return {
      ...currentDraft,
      secondaryKeywords: currentDraft.secondaryKeywords.split(",").map((keyword) => keyword.trim()).filter(Boolean)
    };
  }

  async function request<T>(path: string, init: RequestInit = {}, token = accessToken): Promise<T> {
    const csrfHeaderToken = path === "/api/auth/refresh" || path === "/api/auth/logout"
      ? csrfToken || getCookie("hs_csrf_token")
      : null;
    const response = await fetch(`${apiUrl}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(csrfHeaderToken ? { "x-csrf-token": csrfHeaderToken } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers
      }
    });

    if (response.status === 401 && path !== "/api/auth/refresh" && path !== "/api/auth/login") {
      try {
        const refreshedToken = await refreshAccessToken();
        return request<T>(path, init, refreshedToken);
      } catch {
        setAccessToken("");
        throw new Error("Session expired. Sign in again.");
      }
    }

    const rawText = await response.text();
    const data = rawText ? JSON.parse(rawText) : {};
    if (!response.ok) throw new Error(data.message ?? `Request failed (${response.status})`);
    return data as T;
  }

  async function refreshAccessToken() {
    const data = await request<{ accessToken: string; csrfToken?: string }>("/api/auth/refresh", { method: "POST" }, "");
    setAccessToken(data.accessToken);
    if (data.csrfToken) setCsrfToken(data.csrfToken);
    return data.accessToken;
  }

  async function loadPosts(token = accessToken) {
    setPendingAction("sync");
    const data = await request<{ items: BlogPost[] }>("/api/admin/posts", {}, token);
    setPosts(data.items);
    setPendingAction(null);
  }

  async function loadSettings(token = accessToken) {
    setSettings(await request<AdminSettings>("/api/admin/settings", {}, token));
  }

  async function loadMedia(token = accessToken) {
    const data = await request<{ items: MediaAsset[] }>("/api/admin/media/covers", {}, token);
    setCoverImages(data.items);
  }

  async function refreshAdminData() {
    try {
      setPendingAction("sync");
      await Promise.all([loadPosts(), loadSettings(), loadMedia()]);
      setSuccess("Admin data refreshed");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      setPendingAction(null);
    }
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    setPendingAction("auth");
    setStatus(null);
    try {
      const data = await request<{ accessToken: string; csrfToken?: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: credentials.login, password: credentials.password })
      }, "");
      setAccessToken(data.accessToken);
      if (data.csrfToken) setCsrfToken(data.csrfToken);
      setCredentials({ login: "", password: "" });
      setSuccess("Signed in");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Login failed");
    } finally {
      setPendingAction(null);
    }
  }

  async function logout() {
    setPendingAction("auth");
    await request("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setAccessToken("");
    setCsrfToken("");
    setPosts([]);
    setSettings(null);
    setSelectedSlug("");
    setDraft(createNewDraft());
    setSuccess("Signed out");
    setPendingAction(null);
  }

  function selectPost(post: BlogPost) {
    setSelectedSlug(post.slug);
    setDraft(toDraftPost(post));
    setStatus(null);
  }

  function newPost() {
    setActivePanel("articles");
    setSearch("");
    setStatusFilter("all");
    setSelectedSlug("");
    setDraft(createNewDraft());
    setStatus(null);
  }

  function duplicatePost() {
    setSelectedSlug("");
    setDraft((current) => ({
      ...current,
      title: `${current.title} (copy)`,
      slug: "",
      status: "draft",
      publishedAt: new Date().toISOString().slice(0, 10)
    }));
    setInfo("Copy created in editor as a new draft");
  }

  async function savePost(event: FormEvent) {
    event.preventDefault();
    setPendingAction("save-post");
    setStatus(null);
    try {
      const saved = await request<BlogPost>(isEditing ? `/api/admin/posts/${selectedSlug}` : "/api/admin/posts", {
        method: isEditing ? "PUT" : "POST",
        body: JSON.stringify(toPostPayload(draft))
      });
      setSelectedSlug(saved.slug);
      setDraft(toDraftPost(saved));
      await loadPosts();
      setSuccess("Article saved");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Save failed");
    } finally {
      setPendingAction(null);
    }
  }

  async function deleteSelectedPost() {
    if (!selectedSlug || !window.confirm("Delete this saved article? Sample articles can only be overridden, not deleted.")) return;
    setPendingAction("delete-post");
    try {
      await request(`/api/admin/posts/${selectedSlug}`, { method: "DELETE" });
      setSelectedSlug("");
      setDraft(createNewDraft());
      await loadPosts();
      setSuccess("Article deleted");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setPendingAction(null);
    }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setPendingAction("save-settings");
    try {
      setSettings(await request<AdminSettings>("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify(settings)
      }));
      setSuccess("Generation settings saved");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Settings save failed");
    } finally {
      setPendingAction(null);
    }
  }

  async function generateNow() {
    if (!settings) return;
    setPendingAction("generate");
    setInfo("Generating article...");
    try {
      const savedSettings = await request<AdminSettings>("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify(settings)
      });
      setSettings(savedSettings);
      const generated = await request<{ post: BlogPost }>("/api/ai/generate-article", {
        method: "POST",
        body: JSON.stringify({ topic: savedSettings.generationTopic })
      });
      await Promise.all([loadPosts(), loadSettings()]);
      selectPost(generated.post);
      setActivePanel("articles");
      setSuccess(`Generated article: ${generated.post.title}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Generation failed");
    } finally {
      setPendingAction(null);
    }
  }

  async function uploadCoverImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setPendingAction("upload-media");
    setStatus(null);
    try {
      const asset = await request<MediaAsset>("/api/admin/media/covers", {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, dataUrl: await readFileAsDataUrl(file) })
      });
      setCoverImages((current) => [asset, ...current]);
      setDraft((current) => ({ ...current, coverImage: asset.url }));
      setSuccess("Cover image uploaded");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setPendingAction(null);
    }
  }

  async function deleteCoverImage(asset: MediaAsset) {
    setPendingAction("delete-media");
    setStatus(null);
    try {
      await request(`/api/admin/media/covers/${encodeURIComponent(asset.name)}`, { method: "DELETE" });
      setCoverImages((current) => current.filter((item) => item.name !== asset.name));
      if (draft.coverImage === asset.url) setDraft((current) => ({ ...current, coverImage: "" }));
      setSuccess("Cover image deleted");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setPendingAction(null);
    }
  }

  if (!accessToken) {
    return (
      <section className="admin-auth container">
        <form onSubmit={login}>
          <h1>Admin</h1>
          <p>Sign in with superadmin email and password</p>
          <label>Email<input type="email" value={credentials.login} onChange={(event) => setCredentials((current) => ({ ...current, login: event.target.value }))} autoComplete="username" required /></label>
          <label>Password<input type="password" value={credentials.password} onChange={(event) => setCredentials((current) => ({ ...current, password: event.target.value }))} autoComplete="current-password" required /></label>
          <button type="submit" disabled={pendingAction === "auth"}>{pendingAction === "auth" ? "Signing in..." : "Sign in"}</button>
          {status ? <p className={`status ${status.tone === "error" ? "status-error" : ""}`}>{status.text}</p> : null}
        </form>
      </section>
    );
  }

  return (
    <section className="admin-page container">
      <header className="admin-toolbar">
        <div>
          <h1>Control Room</h1>
          <p>Content ops, generation, and publishing workflow</p>
        </div>
        <div>
          <button type="button" className={activePanel === "articles" ? "" : "btn-secondary"} onClick={() => setActivePanel("articles")}>Articles</button>
          <button type="button" className={activePanel === "generation" ? "" : "btn-secondary"} onClick={() => setActivePanel("generation")}>Generation</button>
          <button type="button" className="btn-secondary" onClick={refreshAdminData} disabled={pendingAction === "sync"}>{pendingAction === "sync" ? "Refreshing..." : "Refresh"}</button>
          <button type="button" onClick={logout} className="btn-secondary" disabled={pendingAction === "auth"}>Logout</button>
        </div>
      </header>

      <div className="admin-kpis">
        <article className="admin-kpi"><span>Total posts</span><strong>{stats.total}</strong></article>
        <article className="admin-kpi"><span>Drafts</span><strong>{stats.drafts}</strong></article>
        <article className="admin-kpi"><span>Published</span><strong>{stats.published}</strong></article>
      </div>

      {activePanel === "articles" ? (
        <div className="admin-layout">
          <aside className="admin-list">
            <div className="admin-list-head">
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, slug, keyword" />
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | "draft" | "published")}>
                <option value="all">All statuses</option>
                <option value="draft">Drafts</option>
                <option value="published">Published</option>
              </select>
            </div>
            {filteredPosts.length === 0 ? <p className="empty-list">No posts match the current filter.</p> : null}
            {filteredPosts.map((post) => (
              <button type="button" key={post.slug} className={post.slug === selectedSlug ? "is-active" : ""} onClick={() => selectPost(post)}>
                <span>{post.title}</span>
                <small>{post.publishedAt} · {post.rating} · {post.status ?? "published"}</small>
              </button>
            ))}
          </aside>

          <form className="admin-editor" onSubmit={savePost}>
            <div className="admin-meta-bar">
              <span>{isEditing ? `Editing: ${selectedSlug}` : "Creating new article"}</span>
              {draft.status ? <span className={`status-chip status-${draft.status}`}>{draft.status}</span> : null}
            </div>
            <div className="admin-grid">
              <label>Title<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required /></label>
              <label>Slug<input value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: event.target.value })} /></label>
              <label>Author<input value={draft.author} onChange={(event) => setDraft({ ...draft, author: event.target.value })} required /></label>
              <label>Published<input type="date" value={draft.publishedAt} onChange={(event) => setDraft({ ...draft, publishedAt: event.target.value })} required /></label>
              <label>Read minutes<input type="number" min="1" value={draft.readTimeMinutes} onChange={(event) => setDraft({ ...draft, readTimeMinutes: Number(event.target.value) })} required /></label>
              <label>Rating<select value={draft.rating} onChange={(event) => setDraft({ ...draft, rating: event.target.value as BlogPost["rating"] })}>{["A+", "A", "B", "C", "D", "F"].map((rating) => <option key={rating} value={rating}>{rating}</option>)}</select></label>
              <label>Status<select value={draft.status ?? "published"} onChange={(event) => setDraft({ ...draft, status: event.target.value as BlogPost["status"] })}><option value="draft">Draft</option><option value="published">Published</option></select></label>
              <label>Category<input value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} required /></label>
              <label>Primary keyword<input value={draft.primaryKeyword} onChange={(event) => setDraft({ ...draft, primaryKeyword: event.target.value })} required /></label>
            </div>
            <label>Excerpt<textarea value={draft.excerpt} onChange={(event) => setDraft({ ...draft, excerpt: event.target.value })} required /></label>
            <label>Secondary keywords<input value={draft.secondaryKeywords} onChange={(event) => setDraft({ ...draft, secondaryKeywords: event.target.value })} placeholder="fiber, blood sugar, longevity" /></label>
            <label>Cover image URL<input value={draft.coverImage} onChange={(event) => setDraft({ ...draft, coverImage: event.target.value })} /></label>
            <section className="admin-media-panel">
              <div className="admin-media-head">
                <div>
                  <h2>Cover images</h2>
                  <p>Upload reusable images for article covers and AI-generated posts.</p>
                </div>
                <label className="media-upload-button">
                  {pendingAction === "upload-media" ? "Uploading..." : "Upload image"}
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={uploadCoverImage} disabled={isBusy} />
                </label>
              </div>
              <div className="admin-media-grid">
                {coverImages.map((asset) => (
                  <article key={asset.name} className="admin-media-card">
                    <img src={assetUrl(asset.url)} alt="" />
                    <div>
                      <strong>{asset.name}</strong>
                      <small>{Math.round(asset.size / 1024)} KB</small>
                    </div>
                    <button type="button" className="btn-secondary" onClick={() => setDraft({ ...draft, coverImage: asset.url })}>Use</button>
                    <button type="button" className="danger-button" onClick={() => deleteCoverImage(asset)} disabled={isBusy}>Delete</button>
                  </article>
                ))}
                {coverImages.length === 0 ? <p className="empty-list">No uploaded cover images yet.</p> : null}
              </div>
            </section>
            <label>Article HTML<textarea className="content-editor" value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} required /></label>
            <footer className="admin-actions">
              <button type="submit" disabled={isBusy}>{pendingAction === "save-post" ? "Saving..." : isEditing ? "Save changes" : "Create article"}</button>
              <button type="button" className="btn-secondary" disabled={isBusy} onClick={duplicatePost}>Duplicate as draft</button>
              <button type="button" className="btn-secondary" disabled={isBusy} onClick={newPost}>Reset editor</button>
              {isEditing ? <button type="button" className="danger-button" disabled={isBusy} onClick={deleteSelectedPost}>Delete</button> : null}
              {status ? <p className={`status ${status.tone === "error" ? "status-error" : ""}`}>{status.text}</p> : null}
            </footer>
          </form>
        </div>
      ) : null}

      {activePanel === "generation" && settings ? (
        <form className="admin-editor generation-editor" onSubmit={saveSettings}>
          <div className="admin-grid">
            <label>Auto generation<select value={settings.autoGenerationEnabled ? "enabled" : "disabled"} onChange={(event) => setSettings({ ...settings, autoGenerationEnabled: event.target.value === "enabled" })}><option value="disabled">Disabled</option><option value="enabled">Enabled</option></select></label>
            <label>Frequency<select value={settings.generationFrequency} onChange={(event) => setSettings({ ...settings, generationFrequency: event.target.value as AdminSettings["generationFrequency"] })}><option value="manual">Manual only</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
            <label>Generation time<input type="time" value={settings.generationTime} onChange={(event) => setSettings({ ...settings, generationTime: event.target.value })} /></label>
            <label>Topic seed<input value={settings.generationTopic} onChange={(event) => setSettings({ ...settings, generationTopic: event.target.value })} /></label>
          </div>
          <label>Master prompt<textarea className="prompt-editor" value={settings.masterPrompt} onChange={(event) => setSettings({ ...settings, masterPrompt: event.target.value })} /></label>
          <div className="settings-summary">
            <p>Last run: <strong>{settings.lastGeneratedAt ? new Date(settings.lastGeneratedAt).toLocaleString() : "Never"}</strong></p>
            <p>Status: <strong>{settings.lastGenerationStatus ?? "No scheduled generation yet"}</strong></p>
          </div>
          <footer className="admin-actions">
            <button type="submit" disabled={isBusy}>{pendingAction === "save-settings" ? "Saving..." : "Save generation settings"}</button>
            <button type="button" className="btn-secondary" disabled={isBusy || settings.generationTopic.trim().length < 5} onClick={generateNow}>{pendingAction === "generate" ? "Working..." : "Generate now"}</button>
            {status ? <p className={`status ${status.tone === "error" ? "status-error" : ""}`}>{status.text}</p> : null}
          </footer>
        </form>
      ) : null}
    </section>
  );
}

export default function App() {
  const [route, setRoute] = useState(() => window.location.pathname);
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [healthIndex, setHealthIndex] = useState<HealthIndex | null>(null);
  const [activePost, setActivePost] = useState<BlogPost | null | undefined>(undefined);

  useEffect(() => {
    const syncRoute = () => setRoute(window.location.pathname);
    window.addEventListener("popstate", syncRoute);
    window.addEventListener("app:navigate", syncRoute);
    return () => {
      window.removeEventListener("popstate", syncRoute);
      window.removeEventListener("app:navigate", syncRoute);
    };
  }, []);

  useEffect(() => {
    getPosts().then(setPosts).catch(() => setPosts([]));
    getHealthIndex().then(setHealthIndex).catch(() => setHealthIndex(null));
  }, []);

  useEffect(() => {
    trackPageView(route);
  }, [route]);

  const slug = route.startsWith("/blog/") ? decodeURIComponent(route.replace("/blog/", "")) : "";

  useEffect(() => {
    if (!slug) {
      setActivePost(undefined);
      return;
    }
    const existing = posts.find((post) => post.slug === slug);
    if (existing) {
      setActivePost(existing);
      return;
    }
    getPostBySlug(slug).then(setActivePost).catch(() => setActivePost(null));
  }, [slug, posts]);

  return (
    <>
      <Header />
      {route === "/admin" ? (
        <AdminPanel />
      ) : route === "/blog" ? (
        <BlogPage posts={posts} />
      ) : slug ? (
        <ArticlePage post={activePost} />
      ) : (
        <HomePage posts={posts} healthIndex={healthIndex} />
      )}
      {route !== "/admin" ? <Footer /> : null}
    </>
  );
}
