/**
 * Stub de `server-only` para o Vitest.
 *
 * O pacote real não exporta nada: ele existe só para o bundler do Next
 * falhar quando um módulo de servidor é importado do cliente. Num runner
 * Node não há bundler, e o import não resolve — daí este arquivo vazio.
 * A garantia continua sendo aplicada pelo `next build`, no gate de CI.
 */
export {};
