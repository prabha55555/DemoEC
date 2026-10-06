import React from 'react';
import { Field, Section, Textarea } from '../ui';
import SettingsForm from './SettingsForm';
import BrandImageField from './BrandImageField';
import useBrandForm from './useBrandForm';

// About page picture and video, and the picture at the top of the order-confirmation email.
export default function MediaSettings() {
  const form = useBrandForm({
    initial: (b) => ({ about_video_caption: b.about_video_caption || '' }),
    toPayload: (v) => ({ about_video_caption: v.about_video_caption }),
    successMessage: 'Caption saved.',
  });
  const { values, set } = form;

  return (
    <SettingsForm form={form}>
      <Section title="About page" description="The picture and video on your About page. Images and videos save as soon as you choose them.">
        <BrandImageField field="about_image" title="About page image" help="Sits next to your brand story. It is shown whole, never cropped, so there is no focal point to set." previewHeight={90} />
        <BrandImageField field="about_video" title="About page video" help="Shown near the top of the About page. Upload an MP4 or WebM file, or paste a video URL." kind="video" accept="video/mp4,video/webm,video/*" folder="brand" />
        <Field label="Video caption" optional hint="Shown when a viewer turns on captions (CC) on the About page video.">
          <Textarea rows={2} value={values.about_video_caption} onChange={v => set('about_video_caption', v)} placeholder="e.g. A quick tour of our latest products." />
        </Field>
      </Section>

      <Section title="Order-confirmation email" description="Optional. A picture shown at the top of the “Your order is confirmed” email; the email looks fine without one.">
        <BrandImageField field="order_confirmation_hero_image" title="Email picture" previewHeight={90} />
      </Section>
    </SettingsForm>
  );
}
