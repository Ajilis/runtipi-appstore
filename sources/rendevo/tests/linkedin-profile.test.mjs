import { test } from 'node:test';
import assert from 'node:assert/strict';
import cookieProvider from '../server/services/providers/linkedin-cookie.js';
import { profileDisplay } from '../server/services/providers/profile-display.js';

const mini = {
  $type: 'com.linkedin.voyager.identity.shared.MiniProfile',
  entityUrn: 'urn:li:fs_miniProfile:abc',
  firstName: 'Camille',
  lastName: 'Martin',
  occupation: 'Consultante produit',
  publicIdentifier: 'camille-martin',
  picture: {
    rootUrl: 'https://media.licdn.com/dms/image/',
    artifacts: [
      { width: 100, fileIdentifyingUrlPathSegment: 'photo-small' },
      { width: 400, fileIdentifyingUrlPathSegment: 'photo-large' },
    ],
  },
};

test('identité et photo : réponse MiniProfile normalisée', () => {
  assert.deepEqual(profileDisplay({
    data: { '*miniProfile': mini.entityUrn },
    included: [mini],
  }), {
    name: 'Camille Martin',
    headline: 'Consultante produit',
    photo_url: 'https://media.licdn.com/dms/image/photo-small',
    profile_url: 'https://www.linkedin.com/in/camille-martin/',
  });
});

test('identité inline et photo absente : affichage de repli', () => {
  assert.deepEqual(profileDisplay({
    data: { miniProfile: { firstName: 'Eva', lastName: 'Leroy', publicIdentifier: 'eva-leroy' } },
  }), {
    name: 'Eva Leroy', headline: '', photo_url: null,
    profile_url: 'https://www.linkedin.com/in/eva-leroy/',
  });
});

test('ne mélange pas les profils et refuse une image sur un hôte tiers', () => {
  const result = profileDisplay({
    data: { '*miniProfile': mini.entityUrn },
    included: [
      { ...mini, entityUrn: 'urn:li:fs_miniProfile:other', firstName: 'Intrus' },
      { ...mini, picture: { rootUrl: 'https://media.licdn.com.evil.example/', artifacts: [{ fileIdentifyingUrlPathSegment: 'x' }] } },
    ],
  });
  assert.equal(result.name, 'Camille Martin');
  assert.equal(result.photo_url, null);
  assert.equal(profileDisplay({ data: {}, included: [mini, { ...mini, firstName: 'Autre' }] }), null);
});

test('ne retourne jamais la réponse brute ni les informations sensibles', () => {
  const result = profileDisplay({ data: { ...mini, email: 'private@example.test', token: 'private-token', cookie: 'secret' } });
  assert.deepEqual(Object.keys(result).sort(), ['headline', 'name', 'photo_url', 'profile_url']);
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('le test du compte inclut uniquement les champs autorisés du profil', async () => {
  const account = { config: { li_at: 'AQED0000000000000000000000', jsessionid: 'ajax:1234567890' } };
  const result = await cookieProvider.test(account, {
    fetcher: async (url, options) => {
      assert.equal(url, 'https://www.linkedin.com/voyager/api/me');
      assert.equal(options.method, 'GET');
      return new Response(JSON.stringify({ data: { '*miniProfile': mini.entityUrn }, included: [mini] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.profile.name, 'Camille Martin');
  assert.ok(!JSON.stringify(result).includes('AQED0000'));
});
