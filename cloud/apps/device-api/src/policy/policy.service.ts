import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

@Injectable()
export class PolicyService {
  readonly canonicalBody = {
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
  } as const;

  private readonly etag: string;

  constructor() {
    this.etag = this.computeEtag(this.canonicalBody);
  }

  maybeNotModified(ifNoneMatch?: string): {
    notModified: boolean;
    body?: typeof this.canonicalBody;
    etag?: string;
  } {
    const tag = ifNoneMatch?.trim();
    if (tag && tag === this.etag) {
      return { notModified: true };
    }
    return {
      notModified: false,
      body: this.canonicalBody,
      etag: this.etag,
    };
  }

  private computeEtag(obj: unknown): string {
    const h = createHash('sha256')
      .update(JSON.stringify(obj))
      .digest('hex')
      .slice(0, 16);
    return `"${h}"`;
  }
}
