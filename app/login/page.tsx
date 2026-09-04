"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogoIcon } from "@/components/Logo";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * ⛔ **Esta tela não cria conta, e a remoção é intencional** (04/09/2026).
 *
 * Ela oferecia "Criar uma conta", que chamava `supabase.auth.signUp` direto. Foi
 * essa porta que produziu a credencial órfã encontrada e apagada em `D-115` —
 * uma conta de auth sem linha em `usuarios`, que na época **entrava**.
 *
 * `D-115` fechou a entrada: sem cadastro correspondente, a sessão é encerrada e
 * a recusa chega aqui por `?recusa=`. Medido de novo depois do conserto, com
 * sessão real injetada: as telas internas param todas em `/login`.
 *
 * ⚖️ **Mas defesa em profundidade não é desculpa para deixar a porta da frente
 * convidando.** Um botão que cria credencial destinada a nunca funcionar é
 * frustração para quem tenta e inventário para quem varre. O acesso nasce de
 * quem administra, nunca de quem chega.
 *
 * ⚠️ **Isto sozinho não impede a credencial de nascer** — a chave anônima é
 * pública e alcança `/auth/v1/signup` sem passar por esta tela. O que fecha de
 * verdade é *Authentication › Sign In / Providers › Allow new users to sign up*
 * no painel do Supabase, que é ato de quem tem a conta.
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  /**
   * A recusa do `middleware.ts` chega por `?recusa=`.
   *
   * ⚠️ Sem isto, quem foi recusado por falta de cadastro vê a tela de login
   * limpa e conclui que errou a senha — e tenta de novo, indefinidamente. Lido
   * em `useEffect` de propósito: `useSearchParams` obrigaria um limite de
   * Suspense só para mostrar uma frase.
   */
  useEffect(() => {
    const motivo = new URLSearchParams(window.location.search).get("recusa");
    if (!motivo) return;
    setErr(
      motivo === "inativo"
        ? "O seu cadastro está desativado. Fale com a conta administradora."
        : "A sua credencial existe, mas não há cadastro correspondente. Fale com a conta administradora."
    );
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.replace("/");
      router.refresh();
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
            <label htmlFor="email">E-mail</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </div>
          <div className="fg">
            <label htmlFor="senha">Senha</label>
            <input id="senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          <div className="err">{err}</div>
          <button className="btn btn-p btn-block" type="submit" disabled={loading}>
            {loading ? "Aguarde..." : "Entrar"}
          </button>
        </form>
        <div className="tiny" style={{ marginTop: 14, textAlign: "center" }}>
          Acesso restrito à equipe. O cadastro é feito por quem administra.
        </div>
      </div>
    </div>
  );
}
