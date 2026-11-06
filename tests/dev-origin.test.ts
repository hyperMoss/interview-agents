import {describe,it,expect} from 'vitest';
import {canonicalDevLocation} from '../apps/web/dev-origin';
const input={origin:'http://localhost:5173',host:'127.0.0.1:5173',url:'/?view=career',method:'GET',accept:'text/html'};
describe('one local application origin',()=>{
 it('keeps the configured identity origin and route instead of creating another identity',()=>{expect(canonicalDevLocation(input)).toBe('http://localhost:5173/?view=career');expect(canonicalDevLocation({...input,host:'localhost:5173'})).toBeNull();});
 it('never redirects API calls, writes, external hosts or protocol-relative paths',()=>{for(const patch of [{url:'/api/v1/career/tasks'},{method:'POST'},{accept:'application/json'},{host:'evil.test:5173'},{host:'localhost.evil.test:5173'},{url:'//evil.test/'},{origin:'https://example.test'}])expect(canonicalDevLocation({...input,...patch})).toBeNull();});
});
