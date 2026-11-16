import assert from "node:assert/strict";
import test from "node:test";
import { userRemovalBlock } from "../../dist-server/user-removal.js";

test("administrador não remove a própria conta", () => {
  assert.equal(userRemovalBlock({
    actorId: "user-1",
    targetId: "user-1",
    targetRole: "admin",
    targetActive: true,
    activeAdminCount: 2,
  }), "Voce nao pode remover sua propria conta.");
});

test("último administrador ativo permanece na empresa", () => {
  assert.equal(userRemovalBlock({
    actorId: "user-1",
    targetId: "user-2",
    targetRole: "admin",
    targetActive: true,
    activeAdminCount: 1,
  }), "A empresa precisa manter pelo menos um administrador ativo.");
});

test("outro integrante e administrador excedente podem ser removidos", () => {
  assert.equal(userRemovalBlock({
    actorId: "user-1",
    targetId: "user-2",
    targetRole: "atendente",
    targetActive: true,
    activeAdminCount: 1,
  }), null);
  assert.equal(userRemovalBlock({
    actorId: "user-1",
    targetId: "user-2",
    targetRole: "admin",
    targetActive: false,
    activeAdminCount: 1,
  }), null);
  assert.equal(userRemovalBlock({
    actorId: "user-1",
    targetId: "user-2",
    targetRole: "admin",
    targetActive: true,
    activeAdminCount: 2,
  }), null);
});
