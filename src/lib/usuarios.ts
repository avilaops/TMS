import { z } from "zod";

// Custo igual ao de prisma/seed.ts.
export const BCRYPT_ROUNDS = 12;

// Campos que as rotas de usuário devolvem. `password` nunca entra aqui.
export const USER_PUBLIC_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  clientId: true,
  createdAt: true,
} as const;

// O que as rotas operacionais devolvem do usuário de um motorista. Usar isto no
// lugar de `include: { user: true }`, que mandaria o hash da senha junto.
export const DRIVER_USER_SELECT = {
  id: true,
  name: true,
  email: true,
} as const;

export const DRIVER_ROLE_MESSAGE =
  "Motorista é criado pelo cadastro de motoristas (Motoristas → Novo), que gera o usuário junto do registro de motorista.";

const role = z.enum(["ADMIN", "OPERATION", "DRIVER", "CLIENT"]);
const name = z.string().trim().min(2, "Informe o nome.").max(120);
// O bcrypt só considera os primeiros 72 bytes; acima disso a senha seria truncada em silêncio.
const password = z
  .string()
  .min(8, "A senha precisa ter pelo menos 8 caracteres.")
  .max(72, "A senha pode ter no máximo 72 caracteres.");
const clientId = z.string().trim().min(1);

export const createUserSchema = z.object({
  name,
  // Normaliza antes de validar: espaço nas pontas e maiúsculas não criam um segundo usuário.
  email: z.string().trim().toLowerCase().max(254).pipe(z.email("E-mail inválido.")),
  role,
  password,
  clientId: clientId.nullish(),
});

export const updateUserSchema = z
  .object({
    name: name.optional(),
    role: role.optional(),
    password: password.optional(),
    clientId: clientId.nullish(),
  })
  .refine((data) => data.name !== undefined || data.role !== undefined || data.password !== undefined, {
    message: "Informe nome, perfil ou senha para alterar.",
  });

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Dados inválidos.";
}
