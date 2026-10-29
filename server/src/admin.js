// Administration: registration mode and user accounts. Administrators only,
// from the app (not with API tokens).

import {
  createUser,
  deleteUserSessions,
  getUserById,
  setUserPassword,
  toPublicUser,
} from "./auth.js";
import { getRegistrationMode, setRegistrationMode } from "./settings.js";

const countActiveAdmins = (db) =>
  db
    .prepare(
      "SELECT COUNT(*) AS count FROM users WHERE is_admin = 1 AND status = 'active'",
    )
    .get().count;

export const registerAdminRoutes = (api, { db, HttpError, requireSession }) => {
  const requireAdmin = (req, res, next) => {
    if (!req.user.is_admin) {
      return next(new HttpError(403, "Action réservée aux administrateurs."));
    }
    next();
  };

  const getTargetUser = (req) => {
    const user = getUserById(db, req.params.id);
    if (!user) {
      throw new HttpError(404, "Utilisateur introuvable.");
    }
    return user;
  };

  /** an administrator can't lock everyone (themselves included) out */
  const assertKeepsAnAdmin = (user) => {
    if (
      user.is_admin &&
      user.status === "active" &&
      countActiveAdmins(db) <= 1
    ) {
      throw new HttpError(
        400,
        "Il doit rester au moins un administrateur actif.",
      );
    }
  };

  api.use("/admin", requireSession, requireAdmin);

  api.get("/admin/settings", (req, res) => {
    res.json({ registrationMode: getRegistrationMode(db) });
  });

  api.put("/admin/settings", (req, res) => {
    try {
      setRegistrationMode(db, req.body?.registrationMode);
    } catch (error) {
      throw new HttpError(400, error.message);
    }
    res.json({ registrationMode: getRegistrationMode(db) });
  });

  api.get("/admin/users", (req, res) => {
    const rows = db
      .prepare(
        `SELECT users.*,
           (SELECT COUNT(*) FROM drawings WHERE owner_id = users.id) AS drawings
         FROM users
         ORDER BY users.status = 'pending' DESC, users.created_at`,
      )
      .all();
    res.json({
      users: rows.map((row) => ({
        ...toPublicUser(row),
        drawings: row.drawings,
      })),
    });
  });

  api.post("/admin/users", async (req, res) => {
    const { username, password, isAdmin } = req.body || {};
    let user;
    try {
      user = await createUser(db, {
        username,
        password,
        isAdmin: !!isAdmin,
        status: "active",
      });
    } catch (error) {
      throw new HttpError(400, error.message);
    }
    res.status(201).json({ user: toPublicUser(user) });
  });

  api.post("/admin/users/:id/approve", (req, res) => {
    const user = getTargetUser(req);
    db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(user.id);
    res.json({ user: toPublicUser({ ...user, status: "active" }) });
  });

  api.patch("/admin/users/:id", async (req, res) => {
    const user = getTargetUser(req);
    const { isAdmin, password } = req.body || {};
    if (typeof isAdmin === "boolean" && isAdmin !== !!user.is_admin) {
      if (!isAdmin) {
        if (user.id === req.user.id) {
          throw new HttpError(
            400,
            "Vous ne pouvez pas retirer vos propres droits d'administrateur.",
          );
        }
        assertKeepsAnAdmin(user);
      }
      db.prepare("UPDATE users SET is_admin = ? WHERE id = ?").run(
        isAdmin ? 1 : 0,
        user.id,
      );
    }
    if (password !== undefined) {
      try {
        await setUserPassword(db, user.id, password);
      } catch (error) {
        throw new HttpError(400, error.message);
      }
      // log the user out everywhere
      deleteUserSessions(db, user.id);
    }
    res.json({ user: toPublicUser(getUserById(db, user.id)) });
  });

  api.delete("/admin/users/:id", (req, res) => {
    const user = getTargetUser(req);
    if (user.id === req.user.id) {
      throw new HttpError(
        400,
        "Vous ne pouvez pas supprimer votre propre compte.",
      );
    }
    assertKeepsAnAdmin(user);
    // drawings, sessions, tokens and library go with it (ON DELETE CASCADE)
    db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
    res.json({ ok: true });
  });
};
