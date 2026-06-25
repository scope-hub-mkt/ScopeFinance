"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogoIcon } from "@/components/Logo";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setMsg("");
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMsg("Conta criada. Se a confirmação de e-mail estiver ativa, confirme antes de entrar.");
        setMode("login");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/");
        router.refresh();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao autenticar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login">
      <div className="login-box">
        <div className="login-head">
          <LogoIcon size={40} />
          <div>
            <div className="sb-name">Scope Company</div>
            <div className="sb-sub">Finance</div>
          </div>
        </div>
        <form onSubmit={submit}>
          <div className="fg">
            <label>E-mail</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </div>
          <div className="fg">
            <label>Senha</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} required />
          </div>
          <div className="err">{err}</div>
          {msg && <div className="tiny" style={{ color: "var(--green)" }}>{msg}</div>}
          <button className="btn btn-p btn-block" type="submit" disabled={loading}>
            {loading ? "Aguarde..." : mode === "login" ? "Entrar" : "Criar conta"}
          </button>
        </form>
        <div style={{ marginTop: 14, textAlign: "center" }}>
          <button className="link" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setErr(""); setMsg(""); }}>
            {mode === "login" ? "Criar uma conta" : "Já tenho conta — entrar"}
          </button>
        </div>
      </div>
    </div>
  );
}
