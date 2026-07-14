type ResolveAvailableContextFileInput = {
  workspace: string;
  exists: (filePath: string) => Promise<boolean>;
};

export const CONTEXT_FILE_BASE_NAME = 'Context';
export const CONTEXT_FILE_EXTENSION = '.md';

export const buildWorkspaceFilePath = (workspace: string, fileName: string): string => {
  const normalizedWorkspace = workspace.endsWith('/') ? workspace.slice(0, -1) : workspace;
  return `${normalizedWorkspace}/${fileName}`;
};

export const getContextFileName = (): string => `${CONTEXT_FILE_BASE_NAME}${CONTEXT_FILE_EXTENSION}`;

export const resolveContextFile = (workspace: string): { fileName: string; filePath: string } => {
  const fileName = getContextFileName();
  return { fileName, filePath: buildWorkspaceFilePath(workspace, fileName) };
};

export const resolveAvailableContextFile = async ({
  workspace,
  exists: _exists,
}: ResolveAvailableContextFileInput): Promise<{ fileName: string; filePath: string }> => {
  return resolveContextFile(workspace);
};
