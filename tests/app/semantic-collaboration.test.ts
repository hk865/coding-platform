import {it} from 'vitest';
import {createGuiServer} from '../../src/app/server.js';
import {semanticCollaborationFixture} from './semantic-collaboration-fixture.js';

it('real HTTP/SQLite/kernel task investigates feedback, delivers a sourced supplement, repairs FAIL and automatically reverifies',()=>semanticCollaborationFixture(createGuiServer),120000);
