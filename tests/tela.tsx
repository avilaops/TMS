import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Apoio dos testes de tela (`*.test.tsx`, com `@vitest-environment jsdom`):
 * monta o componente num documento de verdade, sem navegador.
 */

// O React só aceita `act` fora do navegador com este aviso ligado.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const montados: { root: Root; container: HTMLElement }[] = [];

export async function montar(tela: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  montados.push({ root, container });
  await act(async () => {
    root.render(tela);
  });
  return container;
}

/** Chame no `afterEach`: desmonta o que o teste montou. */
export async function desmontarTudo() {
  for (const { root, container } of montados.splice(0)) {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
}

/** Deixa efeitos, promessas e temporizadores pendentes rodarem. */
export async function assentar(ms = 20) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** Espera a tela chegar ao estado que `confere` exige; falha com o erro dele se não chegar. */
export async function ate(confere: () => void, tentativas = 100) {
  for (let i = 0; ; i += 1) {
    try {
      confere();
      return;
    } catch (erro) {
      if (i >= tentativas) throw erro;
      await assentar(10);
    }
  }
}

export async function clicar(alvo: Element) {
  await act(async () => {
    alvo.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** Botão ou link pelo texto visível. */
export function porTexto(container: ParentNode, seletor: string, texto: string | RegExp) {
  const achados = [...container.querySelectorAll(seletor)].filter((no) =>
    typeof texto === "string" ? (no.textContent ?? "").includes(texto) : texto.test(no.textContent ?? ""),
  );
  return achados as HTMLElement[];
}
