type UserRemovalInput = {
  actorId: string;
  targetId: string;
  targetRole: string;
  targetActive: boolean;
  activeAdminCount: number;
};

export function userRemovalBlock(input: UserRemovalInput): string | null {
  if (input.actorId === input.targetId) {
    return "Voce nao pode remover sua propria conta.";
  }
  if (input.targetRole === "admin" && input.targetActive && input.activeAdminCount <= 1) {
    return "A empresa precisa manter pelo menos um administrador ativo.";
  }
  return null;
}
