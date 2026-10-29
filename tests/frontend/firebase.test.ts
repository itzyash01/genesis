import { afterEach, describe, expect, it, vi } from 'vitest';
const mock=vi.hoisted(()=>({initialize:vi.fn(()=>({app:true})),auth:vi.fn(()=>({auth:true})),functions:vi.fn(()=>({functions:true})),authEmulator:vi.fn(),functionsEmulator:vi.fn(),appCheck:vi.fn(()=>({check:true})),getToken:vi.fn(async()=>({token:'token'}))}));
vi.mock('firebase/app',()=>({initializeApp:mock.initialize}));
vi.mock('firebase/auth',()=>({getAuth:mock.auth,connectAuthEmulator:mock.authEmulator}));
vi.mock('firebase/functions',()=>({getFunctions:mock.functions,connectFunctionsEmulator:mock.functionsEmulator}));
vi.mock('firebase/app-check',()=>({getToken:mock.getToken,initializeAppCheck:mock.appCheck,ReCaptchaEnterpriseProvider:class {constructor(public key:string){}}}));
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();vi.resetModules()});
describe('Firebase client configuration',()=>{
  it('warns about incomplete configuration and skips App Check if no key is set',async()=>{
    const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});vi.stubEnv('VITE_FIREBASE_APP_CHECK_SITE_KEY','');vi.stubEnv('VITE_FIREBASE_EMULATORS','false');
    const firebase=await import('../../frontend/src/lib/firebase');expect(firebase.firebaseApp).toEqual({app:true});expect(await firebase.getAppCheckRequestToken()).toBeUndefined();expect(warning).toHaveBeenCalled();
  });
  it('configures emulators and App Check when enabled',async()=>{
    vi.stubEnv('VITE_FIREBASE_EMULATORS','true');vi.stubEnv('VITE_FIREBASE_APP_CHECK_SITE_KEY','site-key');vi.spyOn(console,'warn').mockImplementation(()=>{});
    const firebase=await import('../../frontend/src/lib/firebase');expect(mock.authEmulator).toHaveBeenCalled();expect(mock.functionsEmulator).toHaveBeenCalled();expect(mock.appCheck).toHaveBeenCalled();expect(await firebase.getAppCheckRequestToken()).toBe('token');
  });
});
