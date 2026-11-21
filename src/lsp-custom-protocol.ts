import { NotificationType } from "vscode-languageclient";

export interface PublishServerStatusParams {
    text: string;
}

export const publishServerStatusType = new NotificationType<PublishServerStatusParams>(
    "tangu/publishServerStatus",
);

export const legacyPublishServerStatusType = new NotificationType<PublishServerStatusParams>(
    "tan/publishServerStatus",
);

export interface ExpandMacroResult {
    uri: string;
    range?: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
    original: string;
    expanded: string;
    success: boolean;
    message?: string;
}

export interface EvalExpressionResult {
    stdout: string;
    stderr: string;
    exit_code: number | null;
    timed_out: boolean;
    truncated: boolean;
    success: boolean;
}
