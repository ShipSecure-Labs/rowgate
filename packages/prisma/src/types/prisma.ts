/**
 * Generic Prisma client interface - accepts a PrismaClient
 * Inspired by better-auth's approach: https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/adapters/prisma-adapter/prisma-adapter.ts
 * 
 * This type represents any Prisma client with dynamic model access
 * This allows us to work with any Prisma client without importing specific types
 */

import type { Prisma } from "@prisma/client"

export type PrismaClient =  {
  $connect: () => Promise<void>
  $disconnect: () => Promise<void>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $transaction: <T>(callback: (tx: any) => Promise<T>, options?: any) => Promise<T>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $queryRaw: <T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]) => Promise<T>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $queryRawUnsafe: <T = unknown>(query: string, ...values: any[]) => Promise<T>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $executeRaw: (query: TemplateStringsArray | Prisma.Sql, ...values: any[]) => Promise<number>
  [key: string]: any
}