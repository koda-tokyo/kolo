// Stub: gateway-v3 authority index

export class StateAuthority {
  private domain: string;

  constructor(domain: string) {
    this.domain = domain;
  }

  getDomain(): string {
    return this.domain;
  }
}
