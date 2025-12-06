import * as vscode from "vscode";
import { Disposable, StatusBarItem } from "vscode";
import { LanguageClient, State } from "vscode-languageclient/node";
import { publishServerStatusType } from "./lsp-custom-protocol";

// #todo what is a good name for this class?
export class ServerStatusSubscription implements Disposable {
    private subscriptions: Disposable[] = [];
    private item: StatusBarItem;

    constructor(
        client: LanguageClient,
        private readonly _clientOutputChannel: vscode.OutputChannel,
    ) {
        this.item = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
        );
        this.item.text = "👅 Starting...";
        this.item.tooltip = "Tangu server";
        this.item.show();

        this.subscriptions.push(
            client.onNotification(
                publishServerStatusType,
                (notification) => {
                    this.item.text = notification.text;
                },
            ),
        );

        this.subscriptions.push(
            client.onDidChangeState((event) => {
                if (event.newState === State.Running) {
                    this.item.text = "👅";
                } else if (event.newState === State.Stopped) {
                    this.item.text = "👅 Stopped";
                }
            }),
        );
    }

    public dispose() {
        for (const subscription of this.subscriptions) {
            subscription.dispose();
        }
        this.item.dispose();
        this.item.hide();
    }
}
