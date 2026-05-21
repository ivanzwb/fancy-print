import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';

export interface PolicyBody {
  version: number;
  schema: string;
  content_modes_allowed: string[];
  features: {
    remote_print_gate: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const DEFAULT_POLICY: PolicyBody = {
  version: 1,
  schema: 'fancy-print.policy.v1',
  content_modes_allowed: [
    'coloring_quiet_book',
    'paper_craft',
    'dress_up',
  ],
  features: {
    remote_print_gate: false,
  },
};

@Injectable()
export class PolicyService {
  private readonly logger = new Logger(PolicyService.name);
  private _body: PolicyBody;
  private _etag: string;

  constructor() {
    this._body = { ...DEFAULT_POLICY };
    const path = process.env.POLICY_JSON_PATH?.trim();
    if (path) {
      this._body = this.loadFromFile(path);
    }
    this._etag = this.computeEtag(this._body);
  }

  /** The current policy body (read-only snapshot). */
  get canonicalBody(): Readonly<PolicyBody> {
    return this._body;
  }

  /** The current ETag for the policy body. */
  get etag(): string {
    return this._etag;
  }

  maybeNotModified(ifNoneMatch?: string): {
    notModified: boolean;
    body?: PolicyBody;
    etag?: string;
  } {
    const tag = ifNoneMatch?.trim();
    if (tag && tag === this._etag) {
      return { notModified: true };
    }
    return {
      notModified: false,
      body: this._body,
      etag: this._etag,
    };
  }

  /** Reload the policy body from its JSON source at runtime. */
  reload(): void {
    const path = process.env.POLICY_JSON_PATH?.trim();
    if (path) {
      this._body = this.loadFromFile(path);
    } else {
      this._body = { ...DEFAULT_POLICY };
    }
    this._etag = this.computeEtag(this._body);
    this.logger.log(`Policy reloaded, etag=${this._etag}`);
  }

  private loadFromFile(path: string): PolicyBody {
    try {
      const raw = fs.readFileSync(path, 'utf8');
      const parsed = JSON.parse(raw) as PolicyBody;
      if (!this.isValidBody(parsed)) {
        this.logger.warn(
          `Policy JSON at ${path} has invalid structure, falling back to defaults`,
        );
        return { ...DEFAULT_POLICY };
      }
      this.logger.log(`Policy loaded from ${path}`);
      return parsed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to load policy from ${path}: ${msg}, falling back to defaults`,
      );
      return { ...DEFAULT_POLICY };
    }
  }

  private isValidBody(body: unknown): body is PolicyBody {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
    const b = body as Record<string, unknown>;
    return (
      typeof b.version === 'number' &&
      typeof b.schema === 'string' &&
      Array.isArray(b.content_modes_allowed) &&
      b.content_modes_allowed.every((m: unknown) => typeof m === 'string') &&
      b.features != null &&
      typeof b.features === 'object' &&
      !Array.isArray(b.features) &&
      typeof (b.features as Record<string, unknown>).remote_print_gate === 'boolean'
    );
  }

  private computeEtag(obj: unknown): string {
    const h = createHash('sha256')
      .update(JSON.stringify(obj))
      .digest('hex')
      .slice(0, 16);
    return `"${h}"`;
  }
}
