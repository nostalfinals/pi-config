export type GitInfo = {
  branch: string | null;
  changedFiles: number;
  pullRequest: { number: number; url: string } | null;
};

export const emptyGitInfo = (): GitInfo => ({
  branch: null,
  changedFiles: 0,
  pullRequest: null,
});
