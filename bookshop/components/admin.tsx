"use client";
import { useState } from "react";
import type { ShopConfig, Book, Order } from "@/lib/shop/schema";
import Link from "next/link";
type Reports = {
  downloads: number;
  readers: number;
  contributions: number;
  sales: number;
  byBook: Record<string, number>;
  orders: Order[];
  events: { action: string; at: string }[];
  truncated: boolean;
};
const money = (minor: number) => "GH₵" + (minor / 100).toFixed(2);
export default function Admin({
  initial,
  initialEtag,
}: {
  initial: ShopConfig;
  initialEtag: string;
}) {
  const [presetText, setPresetText] = useState(
    initial.settings.presets.join(",")
  );
  const [config, setConfig] = useState(initial),
    [etag, setEtag] = useState(initialEtag),
    [tab, setTab] = useState("Overview"),
    [selected, setSelected] = useState(0),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [reports, setReports] = useState<Reports | null>(null),
    [dirty, setDirty] = useState(false);
  function update(next: ShopConfig) {
    setConfig(next);
    setDirty(true);
  }
  async function api(action: string, body?: unknown) {
    const r = await fetch("/api/admin/" + action, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    return d;
  }
  async function loadReports() {
    setBusy(true);
    try {
      setReports(await api("reports"));
      setMessage("Reports updated.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      const cleaned = {
        ...config,
        books: config.books.map((b) => ({
          ...b,
          chapters: b.chapters.filter((c) => c.trim()),
          benefits: b.benefits.filter((c) => c.trim()),
        })),
        settings: {
          ...config.settings,
          presets: presetText.split(",").map((v) => Number(v.trim())),
        },
      };
      const d = await api("config", { config: cleaned, etag });
      setConfig(d.config);
      setEtag(d.etag);
      setDirty(false);
      setMessage("Changes saved.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(
    file: File,
    apply: (asset: string, pages: number) => void
  ) {
    setBusy(true);
    setMessage("Uploading…");
    try {
      const form = new FormData();
      form.set("file", file);
      const r = await fetch("/api/admin/upload", {
        method: "POST",
        body: form,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      apply(d.asset, d.pages);
      setMessage("Uploaded. Save changes to apply it.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const book = config.books[selected];
  function editBook(key: keyof Book, value: unknown) {
    update({
      ...config,
      books: config.books.map((b, i) =>
        i === selected ? { ...b, [key]: value } : b
      ),
    });
  }
  function newBook() {
    if (config.books.length >= 100) {
      setMessage("The current catalogue supports 100 books.");
      return;
    }
    const id = "book-" + crypto.randomUUID();
    update({
      ...config,
      books: [
        ...config.books,
        {
          id,
          slug: id,
          title: "New book",
          subtitle: "",
          description: "",
          teaser: "",
          category: "Field guide",
          mode: "free",
          priceMinor: 20000,
          published: false,
          pages: 1,
          cover: "/books/acquisition-cover.png",
          pdf: "seed:acquisition",
          chapters: [],
          benefits: [],
        },
      ],
    });
    setSelected(config.books.length);
    setMessage("New draft added. Upload its PDF and cover before publishing.");
  }
  return (
    <div className="admin-wrap">
      <header className="admin-header">
        <div className="admin-brand">
          <Link className="goa-logo" href="/" aria-label="GOA Books home">
            GOA<span>.</span>
          </Link>
          <div>
            <p className="eyebrow">GOA / PRIVATE PUBLISHING</p>
            <h1>Publishing desk</h1>
          </div>
        </div>
        <div className="action-row">
          <Link href="/" className="text-link">
            View bookshop
          </Link>
          <button
            className="button outline"
            onClick={async () => {
              await api("logout", {});
              window.location.reload();
            }}
          >
            Sign out
          </button>
          <button
            className="button gold"
            disabled={busy || !dirty}
            onClick={save}
          >
            {busy ? "Working…" : dirty ? "Save changes" : "All changes saved"}
          </button>
        </div>
      </header>
      <div className="admin-body">
        <nav className="admin-nav">
          {[
            "Overview",
            "Books",
            "Author & services",
            "Contributions & sales",
            "Settings & policies",
          ].map((t) => (
            <button
              key={t}
              className={tab === t ? "active" : ""}
              onClick={() => {
                setTab(t);
                if (
                  (t === "Overview" || t === "Contributions & sales") &&
                  !reports
                )
                  void loadReports();
              }}
            >
              {t}
            </button>
          ))}
        </nav>
        <section className="admin-panel">
          <p role="status" className="status">
            {message}
          </p>
          {tab === "Overview" && (
            <>
              <h2>Keep the picture clear.</h2>
              <button
                className="button outline"
                disabled={busy}
                onClick={loadReports}
              >
                Refresh reports
              </button>
              <div className="metric-grid">
                {[
                  ["File deliveries", reports?.downloads],
                  ["Consenting browsers (estimate)", reports?.readers],
                  [
                    "Verified contributions",
                    reports ? money(reports.contributions) : undefined,
                  ],
                  [
                    "Verified book sales",
                    reports ? money(reports.sales) : undefined,
                  ],
                ].map(([label, value]) => (
                  <article key={label}>
                    <p>{label}</p>
                    <strong>{value ?? "—"}</strong>
                  </article>
                ))}
              </div>
              <p>
                File deliveries count PDFs returned by the server. They do not
                prove a completed save or a read. Browser estimates depend on
                cookies. Payment totals include verified, non-revoked orders
                only; refunds or chargebacks may need reconciliation.
              </p>
              {reports?.truncated && (
                <p className="warning">
                  This report reached its record limit. Totals shown are
                  partial; export and reconcile before using them for
                  accounting.
                </p>
              )}
              <h3>Downloads by book</h3>
              {config.books.map((b) => (
                <p key={b.id}>
                  {b.title}: {reports?.byBook[b.id] ?? "—"}
                </p>
              ))}
              <h3>Recent admin activity</h3>
              {reports?.events.slice(0, 10).map((e, i) => (
                <p key={i}>
                  {new Date(e.at).toLocaleString()} · {e.action}
                </p>
              ))}
            </>
          )}
          {tab === "Books" && (
            <>
              <div className="action-row">
                <h2>Your catalogue</h2>
                <button
                  className="button outline"
                  disabled={busy}
                  onClick={newBook}
                >
                  Add a book
                </button>
              </div>
              <label>
                Choose a book
                <select
                  value={selected}
                  onChange={(e) => setSelected(Number(e.target.value))}
                >
                  {config.books.map((b, i) => (
                    <option value={i} key={b.id}>
                      {b.title}
                      {!b.published ? " · Draft" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {book && (
                <>
                  <div className="form-grid">
                    <label>
                      Title
                      <input
                        maxLength={160}
                        value={book.title}
                        onChange={(e) => editBook("title", e.target.value)}
                      />
                    </label>
                    <label>
                      URL slug
                      <input
                        value={book.slug}
                        onChange={(e) => editBook("slug", e.target.value)}
                      />
                    </label>
                    <label>
                      Category
                      <input
                        value={book.category}
                        onChange={(e) => editBook("category", e.target.value)}
                      />
                    </label>
                    <label>
                      Access
                      <select
                        value={book.mode}
                        onChange={(e) => editBook("mode", e.target.value)}
                      >
                        <option value="free">Free</option>
                        <option value="support">
                          Free with optional support
                        </option>
                        <option value="paid">Paid</option>
                      </select>
                    </label>
                    <label>
                      Paid price (GHS)
                      <input
                        type="number"
                        min="1"
                        step="0.01"
                        value={book.priceMinor / 100}
                        onChange={(e) =>
                          editBook(
                            "priceMinor",
                            Math.round(Number(e.target.value) * 100)
                          )
                        }
                      />
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={book.published}
                        onChange={(e) =>
                          editBook("published", e.target.checked)
                        }
                      />{" "}
                      Published
                    </label>
                  </div>
                  <label>
                    Subtitle
                    <textarea
                      value={book.subtitle}
                      onChange={(e) => editBook("subtitle", e.target.value)}
                    />
                  </label>
                  <label>
                    Description
                    <textarea
                      value={book.description}
                      onChange={(e) => editBook("description", e.target.value)}
                    />
                  </label>
                  <label>
                    Teaser excerpt
                    <textarea
                      rows={8}
                      value={book.teaser}
                      onChange={(e) => editBook("teaser", e.target.value)}
                    />
                  </label>
                  <label>
                    Benefits (one per line)
                    <textarea
                      value={book.benefits.join("\n")}
                      onChange={(e) =>
                        editBook("benefits", e.target.value.split("\n"))
                      }
                    />
                  </label>
                  <label>
                    Contents (one chapter per line)
                    <textarea
                      rows={8}
                      value={book.chapters.join("\n")}
                      onChange={(e) =>
                        editBook("chapters", e.target.value.split("\n"))
                      }
                    />
                  </label>
                  <div className="form-grid">
                    <label>
                      Cover image
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={busy}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f)
                            void upload(f, (asset) => {
                              if (!asset.startsWith("asset:"))
                                throw new Error("Upload an image.");
                              editBook("cover", asset);
                            });
                        }}
                      />
                    </label>
                    <label>
                      Book mockup
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={busy}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f)
                            void upload(f, (asset) => {
                              if (!asset.startsWith("asset:"))
                                throw new Error("Upload an image.");
                              editBook("mockup", asset);
                            });
                        }}
                      />
                    </label>
                    <label>
                      Private PDF · {book.pages} pages
                      <input
                        type="file"
                        accept="application/pdf"
                        disabled={busy}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f)
                            void upload(f, (asset, pages) => {
                              if (!asset.startsWith("file:"))
                                throw new Error("Upload a PDF.");
                              update({
                                ...config,
                                books: config.books.map((b, i) =>
                                  i === selected
                                    ? { ...b, pdf: asset, pages }
                                    : b
                                ),
                              });
                            });
                        }}
                      />
                    </label>
                  </div>
                  <p className="fine">
                    Maximum 4 MB per upload. Files are versioned; previous
                    purchases retain access to their purchased edition. The
                    original free edition cannot become private retroactively.
                    Uncheck Published to archive a book.
                  </p>
                </>
              )}
            </>
          )}
          {tab === "Author & services" && (
            <>
              <h2>The author and the offer.</h2>
              {(["name", "email", "linkedin", "portfolio"] as const).map(
                (k) => (
                  <label key={k}>
                    {k}
                    <input
                      value={config.author[k]}
                      onChange={(e) =>
                        update({
                          ...config,
                          author: { ...config.author, [k]: e.target.value },
                        })
                      }
                    />
                  </label>
                )
              )}
              <label>
                Biography
                <textarea
                  rows={12}
                  value={config.author.bio}
                  onChange={(e) =>
                    update({
                      ...config,
                      author: { ...config.author, bio: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                Campaign-services description
                <textarea
                  rows={5}
                  value={config.author.services}
                  onChange={(e) =>
                    update({
                      ...config,
                      author: { ...config.author, services: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                Portrait
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f)
                      void upload(f, (asset) => {
                        if (!asset.startsWith("asset:"))
                          throw new Error("Upload an image.");
                        update({
                          ...config,
                          author: { ...config.author, portrait: asset },
                        });
                      });
                  }}
                />
              </label>
            </>
          )}
          {tab === "Contributions & sales" && (
            <>
              <h2>Verified payments. Clear records.</h2>
              <button
                className="button outline"
                onClick={loadReports}
                disabled={busy}
              >
                Refresh payments
              </button>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Email</th>
                      <th>Type</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Reference</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports?.orders.map((o) => (
                      <tr key={o.reference}>
                        <td>{new Date(o.createdAt).toLocaleDateString()}</td>
                        <td>{o.email}</td>
                        <td>{o.kind}</td>
                        <td>{money(o.amountMinor)}</td>
                        <td>{o.status}</td>
                        <td>{o.reference}</td>
                        <td>
                          <button
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              try {
                                const r = await api("reconcile", {
                                  reference: o.reference,
                                });
                                setMessage(
                                  r.paid
                                    ? "Payment verified."
                                    : "Not a successful payment."
                                );
                                await loadReports();
                              } catch (e) {
                                setMessage((e as Error).message);
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            Check Paystack
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="fine">
                Pending checkouts are not contributions. Paystack remains the
                authoritative source for fees, settlements, refunds and
                chargebacks.
              </p>
            </>
          )}
          {tab === "Settings & policies" && (
            <>
              <h2>Store settings</h2>
              <label>
                GHS per USD
                <input
                  type="number"
                  min="1"
                  max="100"
                  step="0.01"
                  value={config.settings.ghsPerUsd}
                  onChange={(e) =>
                    update({
                      ...config,
                      settings: {
                        ...config.settings,
                        ghsPerUsd: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
              <label>
                Rate date
                <input
                  type="date"
                  value={config.settings.rateDate}
                  onChange={(e) =>
                    update({
                      ...config,
                      settings: {
                        ...config.settings,
                        rateDate: e.target.value,
                      },
                    })
                  }
                />
              </label>
              <label>
                USD presets (comma-separated)
                <input
                  value={presetText}
                  onChange={(e) => {
                    setPresetText(e.target.value);
                    setDirty(true);
                  }}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={config.settings.paymentsEnabled}
                  onChange={(e) =>
                    update({
                      ...config,
                      settings: {
                        ...config.settings,
                        paymentsEnabled: e.target.checked,
                      },
                    })
                  }
                />{" "}
                Enable contributions and paid checkout
              </label>
              <p className="fine">
                Activate only after the production Paystack key and receipt
                delivery have been checked. Free downloads remain available
                independently.
              </p>
              <label>
                Bookshop terms
                <textarea
                  rows={15}
                  value={config.settings.terms}
                  onChange={(e) =>
                    update({
                      ...config,
                      settings: { ...config.settings, terms: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                Bookshop privacy notice
                <textarea
                  rows={15}
                  value={config.settings.privacy}
                  onChange={(e) =>
                    update({
                      ...config,
                      settings: { ...config.settings, privacy: e.target.value },
                    })
                  }
                />
              </label>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
export function AdminLogin() {
  const [password, setPassword] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <Link className="goa-logo" href="/" aria-label="GOA Books home">
        GOA<span>.</span>
      </Link>
      <p className="eyebrow" style={{ marginTop: 32 }}>GOA / PRIVATE ACCESS</p>
      <h1>Publishing desk</h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const r = await fetch("/api/admin/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ password }),
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            window.location.reload();
          } catch (e) {
            setMessage((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <label>
          Administrator password
          <input
            type="password"
            autoComplete="current-password"
            maxLength={256}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button className="button gold" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p role="status">{message}</p>
      </form>
      <Link href="/">Back to books</Link>
    </main>
  );
}
