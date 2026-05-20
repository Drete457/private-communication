import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import './index.css';
import { FirstLoader } from './components/common/loaders';
import { RenderIf } from './helpers/render-conditional';
import { registerPwaUpdateService } from './services/pwa-update-service';

const bootstrapApp = async (): Promise<void> => {
	const isReloadingForUpdate = await registerPwaUpdateService();
	const rootElement = document.getElementById('root');
	if (!rootElement)
		throw new Error('Root element not found');

	ReactDOM.createRoot(rootElement).render(
		<RenderIf condition={isReloadingForUpdate}
			then={<FirstLoader />}
			otherwise={
				<React.StrictMode>
					<App />
				</React.StrictMode>}
		/>
	);
};

void bootstrapApp();
