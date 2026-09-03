import type { SupabaseClient } from '@supabase/supabase-js';

export type FakeOp = {
  table: string;
  verb: 'select' | 'insert' | 'update' | 'delete';
  filters: Array<[string, unknown]>;
  payload?: unknown;
  single?: 'single' | 'maybeSingle' | null;
  orderBy?: string;
  limit?: number;
  or?: string;
};

export type FakeResult = { data?: unknown; error?: unknown; count?: number | null };
export type FakeHandler = (op: FakeOp) => FakeResult;

export type FakeStorageOp = {
  bucket: string;
  action: 'upload' | 'remove' | 'createSignedUrl' | 'download';
  path?: string;
  paths?: string[];
};
export type FakeStorageHandler = (op: FakeStorageOp) => { data?: unknown; error?: unknown };

export type FakeRpcOp = { fn: string; args: Record<string, unknown> };
export type FakeRpcHandler = (op: FakeRpcOp) => FakeResult;

/**
 * Mock encadeável do supabase-js suficiente pros routers (select/insert/update/
 * delete + eq/or/order/limit/single/maybeSingle). O handler recebe a operação
 * montada e devolve { data, error, count }.
 */
export function makeFakeSupabase(
  handler: FakeHandler,
  storageHandler: FakeStorageHandler = () => ({ error: null }),
  rpcHandler: FakeRpcHandler = () => ({ data: 1, error: null }),
): {
  client: SupabaseClient;
  ops: FakeOp[];
  storageOps: FakeStorageOp[];
  rpcOps: FakeRpcOp[];
} {
  const ops: FakeOp[] = [];
  const storageOps: FakeStorageOp[] = [];
  const rpcOps: FakeRpcOp[] = [];

  function makeBuilder(op: FakeOp) {
    const exec = (): FakeResult => {
      ops.push(op);
      return handler(op);
    };

    const builder: Record<string, unknown> = {
      select(_cols?: string) {
        if (op.verb !== 'select') return builder; // insert/update .select() encadeado
        return builder;
      },
      insert(payload: unknown) {
        op.verb = 'insert';
        op.payload = payload;
        return builder;
      },
      update(payload: unknown) {
        op.verb = 'update';
        op.payload = payload;
        return builder;
      },
      delete(opts?: { count?: string }) {
        op.verb = 'delete';
        if (opts?.count) op.single = null;
        return builder;
      },
      eq(col: string, val: unknown) {
        op.filters.push([col, val]);
        return builder;
      },
      or(expr: string) {
        op.or = expr;
        return builder;
      },
      order(col: string, _opts?: { ascending?: boolean }) {
        op.orderBy = col;
        return builder;
      },
      limit(n: number) {
        op.limit = n;
        return builder;
      },
      single() {
        op.single = 'single';
        return Promise.resolve(exec());
      },
      maybeSingle() {
        op.single = 'maybeSingle';
        return Promise.resolve(exec());
      },
      then(resolve: (r: FakeResult) => unknown, reject?: (e: unknown) => unknown) {
        try {
          return Promise.resolve(exec()).then(resolve, reject);
        } catch (e) {
          return Promise.reject(e).catch(reject);
        }
      },
    };
    return builder;
  }

  const storageBucket = (bucket: string) => ({
    async upload(path: string, _body: unknown, _opts?: unknown) {
      const op: FakeStorageOp = { bucket, action: 'upload', path };
      storageOps.push(op);
      return storageHandler(op);
    },
    async remove(paths: string[]) {
      const op: FakeStorageOp = { bucket, action: 'remove', paths };
      storageOps.push(op);
      return storageHandler(op);
    },
    async createSignedUrl(path: string, _expiresIn: number) {
      const op: FakeStorageOp = { bucket, action: 'createSignedUrl', path };
      storageOps.push(op);
      return storageHandler(op);
    },
    async download(path: string) {
      const op: FakeStorageOp = { bucket, action: 'download', path };
      storageOps.push(op);
      return storageHandler(op);
    },
  });

  const client = {
    from(table: string) {
      return makeBuilder({ table, verb: 'select', filters: [] });
    },
    storage: { from: storageBucket },
    async rpc(fn: string, args: Record<string, unknown>) {
      const op: FakeRpcOp = { fn, args };
      rpcOps.push(op);
      return rpcHandler(op);
    },
  } as unknown as SupabaseClient;

  return { client, ops, storageOps, rpcOps };
}
