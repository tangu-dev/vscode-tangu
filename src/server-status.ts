import * as vscode from "vscode";
import { Disposable, StatusBarItem } from "vscode";
import { LanguageClient, State } from "vscode-languageclient/node";
import {
    legacyPublishServerStatusType,
    publishServerStatusType,
} from "./lsp-custom-protocol";

/** Manages the `👅` Language Server status bar item across server restarts. */
export class ServerStatusSubscription implements Disposable {
    private clientSubscriptions: Disposable[] = [];
    private item: StatusBarItem;

    constructor() {
        this.item = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
        );
        this.item.text = "👅 Starting...";
        this.item.tooltip = "Tangu Language Server — Click for actions";
        this.item.command = "tangu.showStatusMenu";
        this.item.show();
    }

    /** Updates the status bar text directly (e.g., when binary is missing or restarting). */
    public setStatus(text: string): void {
        this.item.text = text;
    }

    /** Attaches status listeners to a LanguageClient instance, replacing any previous listeners. */
    public attach(client: LanguageClient): void {
        this.detachClient();

        const onStatus = (notification: { text: string }) => {
            if (notification?.text) {
                this.item.text = notification.text;
            }
        };

        this.clientSubscriptions.push(
            client.onNotification(publishServerStatusType, onStatus),
            client.onNotification(legacyPublishServerStatusType, onStatus),
            client.onDidChangeState((event) => {
                if (event.newState === State.Running) {
                    this.item.text = "👅";
                } else if (event.newState === State.Starting) {
                    this.item.text = "👅 Starting...";
                } else if (event.newState === State.Stopped) {
                    this.item.text = "👅 Stopped";
                }
            }),
        );
    }

    private detachClient(): void {
        for (const sub of this.clientSubscriptions) {
            sub.dispose();
        }
        this.clientSubscriptions = [];
    }

    public dispose(): void {
        this.detachClient();
        this.item.hide();
        this.item.dispose();
    }
}
