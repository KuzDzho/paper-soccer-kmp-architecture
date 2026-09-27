import { pgTable, text, integer, jsonb, timestamp, serial, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { SerializedState, MatchConfig, ChainRec } from "@/game/engine";

export interface RoomTokens {
  home: string;
  away: string | null;
}

export type { ChainRec };

/** Online PvP rooms. State JSON = SerializedState from src/game/engine. */
export const rooms = pgTable(
  "ps_rooms",
  {
    code: text("code").primaryKey(),
    status: text("status").notNull().default("waiting"), // waiting | playing | finished
    cfg: jsonb("cfg").$type<MatchConfig>().notNull(),
    tokens: jsonb("tokens").$type<RoomTokens>().notNull(),
    state: jsonb("state").$type<SerializedState>().notNull(),
    chains: jsonb("chains")
      .$type<ChainRec[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    seq: integer("seq").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("ps_rooms_status_idx").on(t.status)],
);

/** Finished-match ledger (bot / local / online). */
export const matches = pgTable(
  "ps_matches",
  {
    id: serial("id").primaryKey(),
    mode: text("mode").notNull(), // bot | local | online
    difficulty: text("difficulty"), // easy | medium | hard | null
    scoreHome: integer("score_home").notNull(),
    scoreAway: integer("score_away").notNull(),
    winner: integer("winner"), // 0 | 1 | null (draw)
    moves: integer("moves").notNull().default(0),
    winScore: integer("win_score").notNull().default(3),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("ps_matches_created_idx").on(t.createdAt)],
);
