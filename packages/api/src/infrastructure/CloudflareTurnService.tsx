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

import {Logger} from '@fluxer/api/src/Logger';

export interface IceServer {
	urls: string | Array<string>;
	username?: string;
	credential?: string;
}

interface CachedCredentials {
	iceServers: Array<IceServer>;
	expiresAt: number;
}

export class CloudflareTurnService {
	private readonly keyId: string;
	private readonly apiToken: string;
	private readonly ttl: number;
	private cached: CachedCredentials | null = null;

	constructor(config: {keyId: string; apiToken: string; ttl: number}) {
		this.keyId = config.keyId;
		this.apiToken = config.apiToken;
		this.ttl = config.ttl;
	}

	async generateIceServers(): Promise<Array<IceServer>> {
		if (this.cached && Date.now() < this.cached.expiresAt) {
			return this.cached.iceServers;
		}

		const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(this.keyId)}/credentials/generate-ice-servers`;

		const response = await fetch(url, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${this.apiToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ttl: this.ttl}),
		});

		if (!response.ok) {
			const body = await response.text().catch(() => '');
			Logger.error(
				{status: response.status, body},
				'Failed to generate Cloudflare TURN credentials',
			);
			throw new Error(`Cloudflare TURN API returned ${response.status}`);
		}

		const data = (await response.json()) as {iceServers: Array<IceServer>};
		const iceServers = data.iceServers;

		// Cache for half the TTL to ensure credentials are refreshed well before expiry
		this.cached = {
			iceServers,
			expiresAt: Date.now() + (this.ttl * 1000) / 2,
		};

		Logger.debug({serverCount: iceServers.length}, 'Generated Cloudflare TURN credentials');
		return iceServers;
	}
}
