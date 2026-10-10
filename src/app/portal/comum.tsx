import { AlertCircle } from "lucide-react";

/**
 * Peças que as telas novas do portal repetem: os campos dois por linha no
 * celular e o aviso de quando os dados não carregam.
 */

export const CAMPO =
  "block w-full min-w-0 px-3 py-1.5 md:py-2.5 rounded-xl border border-gray-200 bg-white text-sm outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition-all";
export const ROTULO = "text-xs md:text-sm font-medium text-gray-700";
export const BOTAO =
  "inline-flex items-center justify-center gap-2 px-4 py-2 md:px-5 md:py-2.5 rounded-xl bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 transition-colors disabled:opacity-60";
export const BOTAO_SECUNDARIO =
  "inline-flex items-center justify-center gap-2 px-4 py-2 md:px-5 md:py-2.5 rounded-xl border border-gray-200 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-60";

export function Campo({
  rotulo,
  className = "",
  ...props
}: { rotulo: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`block space-y-0.5 md:space-y-1.5 min-w-0 ${className}`}>
      <span className={ROTULO}>{rotulo}</span>
      <input {...props} className={CAMPO} />
    </label>
  );
}

export function NaoCarregou({ mensagem }: { mensagem: string }) {
  return (
    <div role="alert" className="max-w-xl bg-white border border-amber-200 rounded-2xl p-6 flex gap-4">
      <AlertCircle className="w-6 h-6 text-amber-600 shrink-0" />
      <div>
        <h1 className="font-outfit font-bold text-lg mb-1">Não foi possível carregar</h1>
        <p className="text-gray-600 text-sm">{mensagem}</p>
      </div>
    </div>
  );
}
