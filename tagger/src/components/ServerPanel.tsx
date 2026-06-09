import { useCallback, useEffect, useState } from "react";
import { getPw, listBundles, ping, setPw, type ServerBundle } from "../api";

interface Props {
  onPick: (name: string) => void;
  onClose: () => void;
}

// Modal: enter the password (once), then list the server's .adnatags bundles
// and pick one to tag. Used on phone + desktop alike.
export function ServerPanel({ onPick, onClose }: Props) {
  const [phase, setPhase] = useState<"pw" | "list">(getPw() ? "list" : "pw");
  const [pwDraft, setPwDraft] = useState("");
  const [bundles, setBundles] = useState<ServerBundle[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try { setBundles(await listBundles()); setPhase("list"); }
    catch (e) {
      if ((e as Error).message === "401") { setPhase("pw"); setError("密码不对，请重输"); }
      else setError((e as Error).message);
    } finally { setBusy(false); }
  }, []);

  // if a password is already stored, jump straight to the list
  useEffect(() => { if (getPw()) void load(); }, [load]);

  const submitPw = useCallback(async () => {
    setBusy(true); setError("");
    const ok = await ping(pwDraft);
    setBusy(false);
    if (!ok) { setError("密码不对"); return; }
    setPw(pwDraft);
    void load();
  }, [pwDraft, load]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>从服务器打开</strong>
          <button className="link" onClick={onClose}>关闭</button>
        </div>

        {error && <div className="modal-err">{error}</div>}

        {phase === "pw" ? (
          <div className="pw-form">
            <div className="muted small">输入密码访问服务器上的 palette 集合</div>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              placeholder="密码"
              value={pwDraft}
              onChange={(e) => setPwDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submitPw(); }}
            />
            <button disabled={busy || !pwDraft} onClick={() => void submitPw()}>进入</button>
          </div>
        ) : (
          <div className="bundle-list">
            {busy && <div className="muted">加载中…</div>}
            {!busy && bundles.length === 0 && <div className="muted">服务器文件夹里没有 .adnatags</div>}
            {bundles.map((b) => (
              <button key={b.name} className="bundle-row" onClick={() => onPick(b.name)}>
                <span className="bn">{b.name}</span>
                <span className="bm">
                  {b.hasProgress ? `已标 ${b.tagged}` : "未开始"} · {(b.size / 1024).toFixed(0)}KB
                </span>
              </button>
            ))}
            <button className="link refresh" disabled={busy} onClick={() => void load()}>刷新列表</button>
          </div>
        )}
      </div>
    </div>
  );
}
