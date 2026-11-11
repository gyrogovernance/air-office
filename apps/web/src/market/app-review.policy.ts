export interface ProjectReview {
  id: string;
  appId: string;
  scopeId: string;
  scopeName: string;
  text: string;
  instructions: string;
  sources: { name: string; versionId: string }[];
}
