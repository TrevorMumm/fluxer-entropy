/*
 * Copyright (C) 2026 Fluxer Contributors
 *
 * This file is part of Fluxer.
 *
 * Fluxer is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Fluxer is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Fluxer. If not, see <https://www.gnu.org/licenses/>.
 */

import {Logger} from '@app/lib/Logger';

const logger = new Logger('TurnPortRewriter');

let installed = false;

/**
 * Installs a RTCPeerConnection wrapper that rewrites TURN server ports.
 *
 * This is needed when LiveKit's built-in TURN server listens on an internal
 * port (e.g. 5349) but is externally reachable on a different port (e.g. 8443)
 * via a TLS-terminating proxy like Tailscale Funnel.
 *
 * LiveKit advertises `tls_port` as both the listen and advertised port, so
 * the ICE server URLs in the JoinResponse contain the internal port. This
 * wrapper transparently rewrites them before the PeerConnection is created.
 */
export function installTurnPortRewriter(internalPort: number, externalPort: number): void {
	if (installed) return;
	if (internalPort === externalPort) return;

	const OriginalRTCPeerConnection = window.RTCPeerConnection;

	const rewriteUrl = (url: string): string => {
		const rewritten = url.replace(`:${internalPort}`, `:${externalPort}`);
		if (rewritten !== url) {
			logger.debug('Rewrote TURN URL', {from: url, to: rewritten});
		}
		return rewritten;
	};

	const rewriteIceServers = (servers: RTCIceServer[]): RTCIceServer[] =>
		servers.map((server) => ({
			...server,
			urls: Array.isArray(server.urls) ? server.urls.map(rewriteUrl) : rewriteUrl(server.urls),
		}));

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const WrappedRTCPeerConnection = function (this: any, config?: RTCConfiguration, ...rest: any[]) {
		if (config?.iceServers) {
			config = {...config, iceServers: rewriteIceServers(config.iceServers)};
		}
		if (new.target) {
			return Reflect.construct(OriginalRTCPeerConnection, [config, ...rest], new.target);
		}
		return new OriginalRTCPeerConnection(config);
	} as unknown as typeof RTCPeerConnection;

	WrappedRTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype;
	Object.setPrototypeOf(WrappedRTCPeerConnection, OriginalRTCPeerConnection);
	WrappedRTCPeerConnection.generateCertificate = OriginalRTCPeerConnection.generateCertificate;

	window.RTCPeerConnection = WrappedRTCPeerConnection;

	installed = true;
	logger.info('Installed TURN port rewriter', {internalPort, externalPort});
}
