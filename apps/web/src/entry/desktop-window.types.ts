export interface LemonadeBootstrapStatus {
  kind: string;
  generation: number | null;
  base_origin: string | null;
  release: string;
  state: string;
}

export interface NativeBootstrap {
  service_base: string;
  lemonade: LemonadeBootstrapStatus;
}
