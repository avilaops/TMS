"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { pushDataLayer } from "@/lib/analytics";

export default function QuotePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData);

    try {
      const res = await fetch("/api/cotacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const result = await res.json();
        throw new Error(result.error || "Erro ao enviar solicitação.");
      }

      // Depois do `res.ok`, não no envio: a cotação que a API recusou não
      // chegou a ninguém do comercial, e contá-la como lead infla a conversão
      // que vai virar sinal de lance no Ads.
      //
      // Nada do formulário atravessa — nome, telefone e carga ficam na API. O
      // que o GA4 precisa saber é que houve uma cotação, e de onde.
      pushDataLayer({
        event: "generate_lead",
        lead_source: "formulario",
        lead_subject: "cotacao",
        page_path: "/cotacao",
      });

      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao enviar solicitação.");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="min-h-[65vh] bg-gray-50 flex flex-col justify-center items-center p-6">
        <div className="bg-white rounded-2xl shadow-xl p-10 max-w-lg w-full text-center">
          <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-3xl font-black text-gray-900 mb-4">Cotação Enviada!</h1>
          <p className="text-gray-600 mb-8">
            Nossa equipe comercial recebeu sua solicitação e entrará em contato em breve com os valores estimados para o seu frete.
          </p>
          <button
            onClick={() => router.push("/")}
            className="w-full bg-[#f28a00] text-gray-950 font-bold py-4 rounded-xl hover:bg-orange-700 transition"
          >
            Voltar para o Início
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="bg-[#f28a00] px-8 py-10 text-center">
          <h1 className="text-3xl font-black text-gray-950 mb-2">Solicitar Cotação de Frete</h1>
          <p className="text-gray-800">Preencha os dados da carga e receba nossa proposta comercial.</p>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl text-sm font-medium">
              {error}
            </div>
          )}

          <div className="quote-fields">
            <div className="md:col-span-2">
              <label htmlFor="companyName" className="block text-sm font-semibold text-gray-700 mb-2">Nome da Empresa</label>
              <input id="companyName" type="text" name="companyName"
                required
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition"
                placeholder="Razão Social ou Nome Fantasia"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-2">E-mail Corporativo</label>
              <input id="email" type="email" name="email"
                required
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition"
                placeholder="seu@email.com"
              />
            </div>

            <div>
              <label htmlFor="phone" className="block text-sm font-semibold text-gray-700 mb-2">Telefone / WhatsApp</label>
              <input id="phone" type="text" name="phone"
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition"
                placeholder="(00) 00000-0000"
              />
            </div>
          </div>

          <hr className="border-gray-100" />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="origin" className="block text-sm font-semibold text-gray-700 mb-2">Cidade de Origem</label>
              <input id="origin" type="text" name="origin"
                required
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition"
                placeholder="Ex: São Paulo, SP"
              />
            </div>

            <div>
              <label htmlFor="destination" className="block text-sm font-semibold text-gray-700 mb-2">Cidade de Destino</label>
              <input id="destination" type="text" name="destination"
                required
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition"
                placeholder="Ex: Rio de Janeiro, RJ"
              />
            </div>

            <div>
              <label htmlFor="volumes" className="block text-sm font-semibold text-gray-700 mb-2">Quantidade de Volumes</label>
              <input id="volumes" type="number" name="volumes"
                min="1"
                required
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition"
                placeholder="Ex: 50"
              />
            </div>

            <div>
              <label htmlFor="weight" className="block text-sm font-semibold text-gray-700 mb-2">Peso Estimado (kg)</label>
              <input id="weight" type="number" name="weight"
                min="0.1"
                step="0.1"
                required
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition"
                placeholder="Ex: 120.5"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#f28a00] text-gray-950 font-bold py-4 rounded-xl hover:bg-orange-700 transition disabled:opacity-50 disabled:cursor-not-allowed mt-8"
          >
            {loading ? "Enviando..." : "Solicitar Cotação"}
          </button>
        </form>
      </div>
    </div>
  );
}
