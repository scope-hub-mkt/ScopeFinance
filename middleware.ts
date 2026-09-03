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
  if (user && isLogin) {
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
  if (user && !isPerfil) {
    const { data: perfil } = await supabase
      .from("usuarios")
      .select("senha_provisoria")
      .eq("id", user.id)
      .maybeSingle();

    if (perfil?.senha_provisoria) {
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
