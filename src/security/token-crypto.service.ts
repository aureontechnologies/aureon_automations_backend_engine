import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const FORMAT_VERSION = 'v1';

/**
 * Porta idêntica de `backend/src/common/security/token-crypto.service.ts` —
 * mesmo algoritmo/formato de envelope, mesma variável de ambiente
 * `ENCRYPTION_KEY`, para poder decriptar tokens (WhatsApp, chave OpenAI do
 * agente) que o backend principal gravou.
 */
@Injectable()
export class TokenCryptoService {
  private readonly key: Buffer;

  constructor(configService: ConfigService) {
    const hexKey = configService.getOrThrow<string>('ENCRYPTION_KEY');
    const key = Buffer.from(hexKey, 'hex');
    if (key.length !== 32) {
      throw new Error(
        'ENCRYPTION_KEY deve ser uma string hex de 32 bytes (64 caracteres).',
      );
    }
    this.key = key;
  }

  encrypt(plainText: string): string {
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plainText, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      FORMAT_VERSION,
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join('.');
  }

  decrypt(envelope: string): string {
    const [version, ivB64, authTagB64, ciphertextB64] = envelope.split('.');
    if (version !== FORMAT_VERSION || !ivB64 || !authTagB64 || !ciphertextB64) {
      throw new Error('Formato de envelope de criptografia inválido.');
    }

    const decipher = createDecipheriv(
      ALGORITHM,
      this.key,
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
    const plainText = Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64, 'base64')),
      decipher.final(),
    ]);
    return plainText.toString('utf8');
  }
}
