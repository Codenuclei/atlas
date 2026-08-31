import { PrismaClient } from "@prisma/client";
import { createCohesivityDb } from "@/lib/db/cohesivity-client";
import { usesCohesivityPostgres } from "@/lib/cohesivity/postgres";

const globalForDb = globalThis as unknown as {
  prisma?: PrismaClient;
  cohesivityDb?: ReturnType<typeof createCohesivityDb>;
};

function createPrismaDb() {
  return (
    globalForDb.prisma ??
    new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    })
  );
}

const cohesivity = usesCohesivityPostgres();

/** PrismaClient at type level; runtime may be the Cohesivity HTTP adapter. */
export const db = (
  cohesivity
    ? (globalForDb.cohesivityDb ?? createCohesivityDb())
    : createPrismaDb()
) as unknown as PrismaClient;

if (process.env.NODE_ENV !== "production") {
  if (cohesivity) {
    globalForDb.cohesivityDb = db as unknown as ReturnType<typeof createCohesivityDb>;
  } else {
    globalForDb.prisma = db;
  }
}

export const dbProvider = cohesivity ? "cohesivity" : "prisma";
