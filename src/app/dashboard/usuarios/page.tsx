"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AvisoDeAcesso, type Acesso } from "@/components/AvisoDeAcesso";

interface Usuario {
  id: string;
  name: string;
  email: string;
  role: string;
  clientId: string | null;
  createdAt: string;
}

interface Empresa {
  id: string;
  companyName: string;
}

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administrador",
  OPERATION: "Operação",
  CLIENT: "Cliente",
  DRIVER: "Motorista",
};

// Motorista nasce pelo cadastro de motoristas, por isso não aparece aqui.
const ASSIGNABLE_ROLES = ["ADMIN", "OPERATION", "CLIENT"];

const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const EMPTY_FORM = { name: "", email: "", role: "OPERATION", clientId: "" };

async function errorMessage(res: Response, fallback: string) {
  const body = await res.json().catch(() => null);
  return (body && typeof body.error === "string" && body.error) || fallback;
}

export default function UsuariosPage() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // Edição em linha: um usuário por vez.
  const [editing, setEditing] = useState<{ id: string } | null>(null);
  // Resultado da liberação no login único do último cadastro (ou de "Liberar acesso").
  const [acesso, setAcesso] = useState<{ nome: string; acesso: Acesso } | null>(null);
  const [editRole, setEditRole] = useState("OPERATION");
  const [editClientId, setEditClientId] = useState("");

  // Mudar `reloadKey` refaz a busca depois de criar ou alterar um usuário.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((key) => key + 1);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const res = await fetch("/api/usuarios");
        if (!active) return;
        if (res.status === 401 || res.status === 403) {
          setDenied(true);
          return;
        }
        if (res.ok) setUsuarios(await res.json());

        const empresasRes = await fetch("/api/clientes");
        if (active && empresasRes.ok) setEmpresas(await empresasRes.json());
      } catch (error) {
        console.error("Falha ao carregar usuários", error);
      } finally {
        if (active) setIsLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [reloadKey]);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setFeedback(null);
    setIsSaving(true);
    try {
      const res = await fetch("/api/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          role: form.role,
          clientId: form.role === "CLIENT" ? form.clientId || null : null,
        }),
      });
      if (res.ok) {
        const criado = (await res.json()) as { name: string; acesso?: Acesso };
        setForm(EMPTY_FORM);
        setFeedback({ ok: true, text: "Usuário criado." });
        if (criado.acesso) setAcesso({ nome: criado.name, acesso: criado.acesso });
        reload();
      } else {
        setFeedback({ ok: false, text: await errorMessage(res, "Erro ao criar usuário.") });
      }
    } catch {
      setFeedback({ ok: false, text: "Erro ao criar usuário." });
    } finally {
      setIsSaving(false);
    }
  };

  const startEdit = (usuario: Usuario) => {
    setFeedback(null);
    setEditing({ id: usuario.id });
    setEditRole(usuario.role);
    setEditClientId(usuario.clientId ?? "");
  };

  // Pede de novo ao login único a liberação da pessoa. Para quem foi cadastrado
  // com o login único fora do ar, ou perdeu o acesso.
  const liberar = async (usuario: Usuario) => {
    setFeedback(null);
    setIsSaving(true);
    try {
      const res = await fetch(`/api/usuarios/${usuario.id}/acesso`, { method: "POST" });
      const corpo = (await res.json().catch(() => ({}))) as { acesso?: Acesso; error?: string };
      if (corpo.acesso) setAcesso({ nome: usuario.name, acesso: corpo.acesso });
      else setFeedback({ ok: false, text: corpo.error ?? "Erro ao liberar o acesso." });
    } catch {
      setFeedback({ ok: false, text: "Erro ao liberar o acesso." });
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editing) return;
    setFeedback(null);
    setIsSaving(true);
    try {
      const body = { role: editRole, clientId: editRole === "CLIENT" ? editClientId || null : null };
      const res = await fetch(`/api/usuarios/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setFeedback({ ok: true, text: "Perfil alterado." });
        setEditing(null);
        reload();
      } else {
        setFeedback({ ok: false, text: await errorMessage(res, "Erro ao salvar.") });
      }
    } catch {
      setFeedback({ ok: false, text: "Erro ao salvar." });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (denied) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-red-600" />
            Acesso negado
          </CardTitle>
          <CardDescription>
            A gestão de usuários é restrita ao perfil Administrador.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const empresaName = (id: string | null) =>
    empresas.find((empresa) => empresa.id === id)?.companyName ?? "-";

  return (
    <div className="space-y-3 md:space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Usuários</h1>
        <p className="text-gray-500 text-sm mt-1">Quem entra no sistema e com qual perfil</p>
      </div>

      {feedback && (
        <p
          role="status"
          className={`text-sm ${feedback.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
        >
          {feedback.text}
        </p>
      )}

      {acesso && <AvisoDeAcesso nome={acesso.nome} acesso={acesso.acesso} onFechar={() => setAcesso(null)} />}

      <Card>
        <CardHeader>
          <CardTitle>Novo usuário</CardTitle>
          <CardDescription>
            Motoristas são criados em Motoristas, junto do cadastro de motorista.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4">
            <div className="space-y-0.5 md:space-y-1.5 min-w-0">
              <Label htmlFor="usuario-nome">Nome</Label>
              <Input
                id="usuario-nome"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-0.5 md:space-y-1.5 min-w-0">
              <Label htmlFor="usuario-email">E-mail</Label>
              <Input
                id="usuario-email"
                type="email"
                required
                autoComplete="off"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-0.5 md:space-y-1.5 min-w-0">
              <Label htmlFor="usuario-perfil">Perfil</Label>
              <select
                id="usuario-perfil"
                className={SELECT_CLASS}
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                {ASSIGNABLE_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABEL[role]}
                  </option>
                ))}
              </select>
            </div>
            {form.role === "CLIENT" && (
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="usuario-empresa">Empresa</Label>
                <select
                  id="usuario-empresa"
                  required
                  className={SELECT_CLASS}
                  value={form.clientId}
                  onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                >
                  <option value="">Selecione a empresa</option>
                  {empresas.map((empresa) => (
                    <option key={empresa.id} value={empresa.id}>
                      {empresa.companyName}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="md:col-span-2">
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "Salvando..." : "Criar usuário"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usuários cadastrados</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="block md:table w-full text-left text-sm">
              <thead className="hidden md:table-header-group text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
                <tr>
                  <th className="px-3 py-3 font-medium">Nome</th>
                  <th className="px-3 py-3 font-medium">E-mail</th>
                  <th className="px-3 py-3 font-medium">Perfil</th>
                  <th className="px-3 py-3 font-medium">Empresa</th>
                  <th className="px-3 py-3 font-medium">Criado em</th>
                  <th className="px-3 py-3 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="block md:table-row-group divide-y divide-gray-100 dark:divide-gray-800">
                {usuarios.map((usuario) => {
                  const isEditing = editing?.id === usuario.id;
                  return (
                    <tr key={usuario.id} className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 py-2.5 md:table-row">
                      <td className="min-w-0 md:table-cell md:px-3 md:py-3 text-gray-900 dark:text-white">{usuario.name}</td>
                      <td className="col-span-2 min-w-0 md:table-cell md:px-3 md:py-3 text-gray-600 dark:text-gray-300">{usuario.email}</td>
                      <td className="min-w-0 md:table-cell md:px-3 md:py-3">
                        <Badge variant={usuario.role === "ADMIN" ? "default" : "secondary"}>
                          {ROLE_LABEL[usuario.role] ?? usuario.role}
                        </Badge>
                      </td>
                      <td data-rotulo="Empresa" className="min-w-0 md:table-cell md:px-3 md:py-3 text-gray-600 dark:text-gray-300 before:content-[attr(data-rotulo)] before:block before:text-[11px] before:leading-tight before:text-gray-500 md:before:content-none">
                        {empresaName(usuario.clientId)}
                      </td>
                      <td data-rotulo="Criado em" className="min-w-0 md:table-cell md:px-3 md:py-3 text-gray-600 dark:text-gray-300 before:content-[attr(data-rotulo)] before:block before:text-[11px] before:leading-tight before:text-gray-500 md:before:content-none">
                        {new Date(usuario.createdAt).toLocaleDateString("pt-BR")}
                      </td>
                      <td className="col-span-2 min-w-0 md:table-cell md:px-3 md:py-3">
                        {isEditing ? (
                          <div className="flex flex-wrap items-center justify-end gap-2">
                              <>
                                <select
                                  aria-label="Novo perfil"
                                  className={`${SELECT_CLASS} w-40`}
                                  value={editRole}
                                  onChange={(e) => setEditRole(e.target.value)}
                                >
                                  {ASSIGNABLE_ROLES.map((role) => (
                                    <option key={role} value={role}>
                                      {ROLE_LABEL[role]}
                                    </option>
                                  ))}
                                </select>
                                {editRole === "CLIENT" && (
                                  <select
                                    aria-label="Empresa"
                                    className={`${SELECT_CLASS} w-48`}
                                    value={editClientId}
                                    onChange={(e) => setEditClientId(e.target.value)}
                                  >
                                    <option value="">Selecione a empresa</option>
                                    {empresas.map((empresa) => (
                                      <option key={empresa.id} value={empresa.id}>
                                        {empresa.companyName}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </>
                            <Button size="sm" disabled={isSaving} onClick={handleUpdate}>
                              Salvar
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                              Cancelar
                            </Button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap justify-end gap-2">
                            {usuario.role !== "DRIVER" && (
                              <Button size="sm" variant="outline" onClick={() => startEdit(usuario)}>
                                Trocar perfil
                              </Button>
                            )}
                            <Button size="sm" variant="outline" disabled={isSaving} onClick={() => liberar(usuario)}>
                              Liberar acesso
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
