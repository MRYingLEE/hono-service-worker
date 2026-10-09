/// <reference types="jest" />
import { headersToRecord } from './runtime_protocol';

describe('headersToRecord', () => {
  it('copies every header into a plain record', () => {
    const headers = new Headers({
      'content-type': 'text/plain',
      'x-custom': 'value'
    });

    expect(headersToRecord(headers)).toEqual({
      'content-type': 'text/plain',
      'x-custom': 'value'
    });
  });
});
