import { useEffect, useState, useCallback } from "react";

import { RenderIf } from "@/helpers/render-conditional";
import { HealthStatus } from '@/types';

import type { FC} from "react";

interface HealthCheckProps {
  smallComponent?: boolean;
}

const HealthCheck = ({ smallComponent = false }: HealthCheckProps) => {
	const [serverStatus, setServerStatus] = useState<HealthStatus>(HealthStatus.CHECKING);

	const statusColor = useCallback(() => {
		let statusColor = '';

		switch (serverStatus) {
			case HealthStatus.ONLINE:
				statusColor = 'bg-green-500';
				break;
			case HealthStatus.OFFLINE:
				statusColor = 'bg-red-500';
				break;
			case HealthStatus.CHECKING:
			default:
				statusColor = 'bg-yellow-500';
				break;
		}

		return statusColor;
	}, [serverStatus]);

	const statusText = () => {
		let statusText = '';

		switch (serverStatus) {
			case HealthStatus.ONLINE:
				statusText = 'Server is reachable';
				break;
			case HealthStatus.OFFLINE:
				statusText = 'Server is unreachable';
				break;
			case HealthStatus.CHECKING:
			default:
				statusText = 'Checking server availability...';
				break;
		}

		return statusText;
	}

	const checkServerStatus = useCallback(async () => {
		setServerStatus(HealthStatus.CHECKING);
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 4000);
			const response = await fetch('/health', { signal: controller.signal });
			clearTimeout(timeout);

			setServerStatus(response.ok ? HealthStatus.ONLINE : HealthStatus.OFFLINE);
		} catch {
			setServerStatus(HealthStatus.OFFLINE);
		}
	}, []);

	useEffect(() => {
		void checkServerStatus();
	}, [checkServerStatus]);

	const HealthCheckView: FC = () => (
		<div className="flex items-center justify-center gap-2 mb-4 text-sm text-gray-400">
			<span
				className={`w-2 h-2 rounded-full ${statusColor()}`}
			/>
			<RenderIf condition={!smallComponent} then={
				<span>
					{statusText()}
				</span>
			} otherwise={null}
			/>
		</div>
	)

	return { serverStatus, HealthCheckView };
}

export default HealthCheck;