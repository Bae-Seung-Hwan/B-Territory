import { termsOfService } from './terms-of-service';
import { privacyPolicy } from './privacy-policy';
import { locationTerms } from './location-terms';
import type { LegalDocument } from './types';

export type { LegalDocument } from './types';

/**
 * 가입 시 동의를 받는 문서의 종류. 값은 서버에 동의 이력으로 남길 식별자이므로
 * 한 번 정하면 바꾸지 않는다(바꾸면 이미 쌓인 이력과 연결이 끊긴다).
 */
export type LegalDocumentKey = 'service' | 'privacy' | 'location';

export const LEGAL_DOCUMENTS: Record<LegalDocumentKey, LegalDocument> = {
  service: termsOfService,
  privacy: privacyPolicy,
  location: locationTerms,
};

/** 화면 표시 순서 겸, 동의 항목을 빠짐없이 순회하기 위한 목록. */
export const LEGAL_DOCUMENT_KEYS: readonly LegalDocumentKey[] = ['service', 'privacy', 'location'];
