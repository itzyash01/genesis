// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
const mocked=vi.hoisted(()=>({signin:vi.fn(),signup:vi.fn(),reset:vi.fn()}));
vi.mock('firebase/auth',()=>({signInWithEmailAndPassword:mocked.signin,createUserWithEmailAndPassword:mocked.signup,sendPasswordResetEmail:mocked.reset}));
vi.mock('../../frontend/src/lib/firebase',()=>({auth:{}}));
import AuthView from '../../frontend/src/components/AuthView.vue';
beforeEach(()=>vi.clearAllMocks());
describe('authentication',()=>{
  it('rejects short passwords and signs in with a trimmed email',async()=>{
    const wrapper=mount(AuthView);const vm=wrapper.vm as any;
    vm.email='  person@example.invalid  ';vm.password='short';await vm.submit();expect(mocked.signin).not.toHaveBeenCalled();expect(vm.error).toContain('at least 8');
    vm.password='password123';await vm.submit();expect(mocked.signin).toHaveBeenCalledWith(expect.anything(),'person@example.invalid','password123');
  });
  it('creates accounts and surfaces duplicate emails',async()=>{
    const wrapper=mount(AuthView);const vm=wrapper.vm as any;vm.mode='signup';vm.email='a@example.invalid';vm.password='password123';
    mocked.signup.mockRejectedValue(Object.assign(new Error('no'),{code:'auth/email-already-in-use'}));await vm.submit();expect(vm.error).toContain('already has an account');
  });
  it('requires an email for a password reset',async()=>{
    const wrapper=mount(AuthView);const vm=wrapper.vm as any;await vm.resetPassword();expect(vm.error).toContain('Enter your email');
    vm.email='a@example.invalid';await vm.resetPassword();expect(mocked.reset).toHaveBeenCalled();expect(vm.notice).toContain('instructions were sent');
  });
});
