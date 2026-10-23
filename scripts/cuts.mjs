// Что вырезано из оригинальных instructions free-exercise-db при переводе (кроме служебных фраз
// о повторениях — их build-seed.mjs находит сам). orig — дословно из базы (public domain).

const FOOT_NOTE =
  '(Note: For the purposes of this discussion we will use the medium stance described above which targets overall development; however you can choose any of the three stances described in the foot positioning section).';
const KNEES_TIP =
  'Tip: If you performed the exercise correctly, the front of the knees should make an imaginary straight line with the toes that is perpendicular to the front. If your knees are past that imaginary line (if they are past your toes) then you are placing undue stress on the knee and the exercise has been performed incorrectly.';

export const REASONS = {
  ref: 'ссылка на раздел, которого нет в базе',
  disputed: 'спорное утверждение (решение: не возвращать)',
  style: 'стилистическое сравнение без смысла для техники',
  opinion: 'личное мнение автора',
  typo: 'вероятная опечатка',
  contradiction: 'противоречит описанию упражнения',
  otherGrips: 'описание других вариантов хвата, к этому упражнению не относится',
};

export const cuts = {
  Front_Barbell_Squat: [
    { orig: FOOT_NOTE, reason: 'ref' },
    { orig: KNEES_TIP, reason: 'disputed' },
  ],
  Hack_Squat: [
    { orig: FOOT_NOTE, reason: 'ref' },
    { orig: KNEES_TIP, reason: 'disputed' },
  ],
  Leg_Press: [{ orig: FOOT_NOTE, reason: 'ref' }],
  Leg_Extensions: [
    {
      orig: 'If the angle is less than 90-degrees then that means the knee is over the toes which in turn creates undue stress at the knee joint. If the machine is designed that way, either look for another machine or just make sure that when you start executing the exercise you stop going down once you hit the 90-degree angle.',
      reason: 'disputed',
      note: 'ограничение «не глубже 90°» из шага 3 сохранено',
    },
  ],
  Lying_Leg_Curls: [{ orig: '(or you can also use any of the other two stances described on the foot positioning section)', reason: 'ref' }],
  Seated_Leg_Curl: [{ orig: '(or you can also use any of the other two stances)', reason: 'ref' }],
  Barbell_Deadlift: [
    { orig: 'Think of how the soldiers in the military look when they are in standing in attention.', reason: 'style' },
  ],
  Dumbbell_Lunges: [
    {
      orig: 'Note: As in the other exercises, do not allow your knee to go forward beyond your toes as you come down, as this will put undue stress on the knee joint.',
      reason: 'disputed',
      note: 'вертикальная голень из того же шага сохранена',
    },
  ],
  Standing_Calf_Raises: [
    { orig: '(or using any of the two other positions described at the beginning of the chapter)', reason: 'ref' },
    { orig: 'Toes should be facing forward, outwards or inwards as described at the beginning of the chapter.', reason: 'ref' },
  ],
  Seated_Calf_Raise: [
    { orig: 'as per the beginning of this chapter', reason: 'ref', note: 'выбор положения носков сохранён' },
  ],
  Hyperextensions_Back_Extensions: [
    { orig: '(my preference)', reason: 'opinion' },
    { orig: 'as you inhale (на подъёме корпуса, шаг 5)', reason: 'typo', note: 'на опускании в оригинале тоже вдох' },
  ],
  'Wide-Grip_Lat_Pulldown': [
    {
      orig: 'For a medium grip, your hands need to be spaced out at a distance equal to your shoulder width and for a close grip at a distance smaller than your shoulder width.',
      reason: 'otherGrips',
    },
  ],
  'Close-Grip_Front_Lat_Pulldown': [
    { orig: 'with a wide bar attached to the top pulley', reason: 'contradiction' },
    {
      orig: 'Note on grips: For a wide grip, your hands need to be spaced out at a distance wider than your shoulder width. For a medium grip, your hands need to be spaced out at a distance equal to your shoulder width',
      reason: 'otherGrips',
    },
  ],
  Side_Lateral_Raise: [{ orig: 'the hands slightly tilted forward as if pouring water in a glass', reason: 'disputed' }],
};
