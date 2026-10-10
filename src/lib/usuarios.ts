import { z } from "zod";

// Campos que as rotas de usuário devolvem. `password` nunca entra aqui.
export const USER_PUBLIC_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  clientId: true,
  createdAt: true,
  inviteStatus: true,
  inviteDetail: true,
  inviteAt: true,
} as const;

// O que as rotas operacionais devolvem do usuário de um motorista. Usar isto no
// lugar de `include: { user: true }`, que mandaria o hash da senha junto.
export const DRIVER_USER_SELECT = {
  id: true,
  name: true,
  email: true,
} as const;

// O percentual de comissão é dado financeiro: só o administrador o lê. Onde o
// motorista sai inteiro dentro de outro registro (veículo, viagem, carga), ele
// fica de fora (`omit: DRIVER_OMIT`); em /api/motoristas a rota decide pelo perfil.
export const DRIVER_OMIT = { commissionPct: true } as const;

export const DRIVER_ROLE_MESSAGE =
  "Motorista é criado pelo cadastro de motoristas (Motoristas → Novo), que gera o usuário junto do registro de motorista.";

const role = z.enum(["ADMIN", "OPERATION", "DRIVER", "CLIENT"]);
const name = z.string().trim().min(2, "Informe o nome.").max(120);
const clientId = z.string().trim().min(1);

export const createUserSchema = z.object({
  name,
  // Normaliza antes de validar: espaço nas pontas e maiúsculas não criam um segundo usuário.
  email: z.string().trim().toLowerCase().max(254).pipe(z.email("E-mail inválido.")),
  role,
  clientId: clientId.nullish(),
});

export const updateUserSchema = z
  .object({
    name: name.optional(),
    role: role.optional(),
    clientId: clientId.nullish(),
  })
  .refine((data) => data.name !== undefined || data.role !== undefined, {
    message: "Informe nome ou perfil para alterar.",
  });

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Dados inválidos.";
}
