import React from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider, Container } from '@mantine/core';
import '@mantine/core/styles.css';
import { ArchitectureReviews } from '../src/features/architecture-reviews';
import { createApi } from '../src/api/client';
const scope = { projectId: 'proj-alpha', workspaceId: 'ws-shared' };
createRoot(document.getElementById('root')!).render(<React.StrictMode><MantineProvider><Container size="lg" py="md"><ArchitectureReviews api={createApi('browser-scenario')} scope={scope}/></Container></MantineProvider></React.StrictMode>);
