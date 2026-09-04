import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Sem Supabase configurado: deixa passar (a aplicação exibirá o estado de erro/login).
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  let user = null;
  try {
    user = (await supabase.auth.getUser()).data.user;
  } catch {
    // ignora erros de rede/config
  }

  const { pathname } = request.nextUrl;
  const isLogin = pathname === "/login";
  /** A tela onde a senha se troca — sem a exceção o redirecionamento vira laço. */
  const isPerfil = pathname === "/perfil";

  if (!user && !isLogin) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    return NextResponse.redirect(redirectUrl);
  }

  if (user) {
    /**
     * Uma consulta, três perguntas: existe cadastro, ele está ativo, e a senha
     * ainda é provisória.
     */
    const { data: perfil } = await supabase
      .from("usuarios")
      .select("senha_provisoria, ativo")
      .eq("id", user.id)
      .maybeSingle();

    /**
     * ⛔ **Credencial sem cadastro não entra, e cadastro desligado também
     * não** — 04/09/2026.
     *
     * A tela de login oferece **criar conta**, e o Supabase deste projeto está
     * com `disable_signup: false`: qualquer pessoa que alcance `/login` cria
     * uma credencial válida. Até hoje isso bastava para entrar, porque o
     * único teste era "existe sessão?". Medido: havia uma credencial assim,
     * criada e usada no mesmo dia.
     *
     * ⚖️ **A sessão morre aqui, não só o acesso.** Recusar sem encerrar
     * deixaria o cookie válido girando em toda requisição seguinte — e o
     * cookie é o que a API enxerga.
     *
     * ⚠️ `ativo` não era conferido em lugar nenhum: desligar alguém na tela
     * de usuários não o tirava do sistema.
     */
    if (!perfil || (perfil as { ativo: boolean | null }).ativo === false) {
      await supabase.auth.signOut();

      const saida = isLogin
        ? NextResponse.next({ request })
        : (() => {
            const url = request.nextUrl.clone();
            url.pathname = "/login";
            url.search = "";
            // O motivo viaja na URL: recusa muda parece defeito de senha.
            url.searchParams.set("recusa", perfil ? "inativo" : "sem-cadastro");
            return NextResponse.redirect(url);
          })();

      // ⛔ O `signOut` escreveu a expiração dos cookies em `response`, que não
      // é a resposta que sai. Sem copiar, a sessão volta na próxima requisição.
      response.cookies.getAll().forEach((c) => saida.cookies.set(c));
      return saida;
    }

    if (isLogin) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/";
      return NextResponse.redirect(redirectUrl);
    }

    /**
     * `RF-99` / `RN-56` — senha provisória só abre a própria troca.
     *
     * ⛔ **No middleware, não em cada tela.** Trava que depende de cada página
     * lembrar de checar nasce com buraco: uma rota nova basta para a senha
     * conhecida voltar a abrir o sistema inteiro.
     */
    if (!isPerfil && (perfil as { senha_provisoria: boolean | null }).senha_provisoria) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/perfil";
      // O motivo viaja na URL: redirecionamento mudo parece defeito.
      redirectUrl.searchParams.set("provisoria", "1");
      return NextResponse.redirect(redirectUrl);
    }
  }

  return response;
}

export const config = {
  // Aplica em todas as rotas, exceto estáticos e a API (que faz sua própria auth).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api|.*\\.).*)"],
};
