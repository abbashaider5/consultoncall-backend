const mongoose = require('mongoose');
require('dotenv').config();

// Models
const User = require('./models/User');
const Category = require('./models/Category');
const Expert = require('./models/Expert');

// MongoDB connection
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/guidance-marketplace';

const seedDatabase = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ MongoDB Connected for seeding...');

    // Clear existing data
    await User.deleteMany({});
    await Category.deleteMany({});
    await Expert.deleteMany({});
    console.log('🗑️  Cleared existing data');

    // Create Categories with slug
    const categories = await Category.insertMany([
      {
        name: 'Career Counseling',
        slug: 'career-counseling',
        description: 'Get guidance on career paths, job transitions, and professional growth',
        icon: 'FiBriefcase',
        order: 1
      },
      {
        name: 'Mental Health',
        slug: 'mental-health',
        description: 'Talk to certified counselors about stress, anxiety, and emotional well-being',
        icon: 'FiHeart',
        order: 2
      },
      {
        name: 'Legal Advice',
        slug: 'legal-advice',
        description: 'Consult with legal experts on various legal matters',
        icon: 'FiShield',
        order: 3
      },
      {
        name: 'Financial Planning',
        slug: 'financial-planning',
        description: 'Get advice on investments, savings, and financial goals',
        icon: 'FiDollarSign',
        order: 4
      },
      {
        name: 'Education Guidance',
        slug: 'education-guidance',
        description: 'Guidance for students on courses, colleges, and educational paths',
        icon: 'FiBook',
        order: 5
      },
      {
        name: 'Health & Fitness',
        slug: 'health-fitness',
        description: 'Consult nutritionists and fitness experts for a healthier lifestyle',
        icon: 'FiActivity',
        order: 6
      },
      {
        name: 'Relationship Advice',
        slug: 'relationship-advice',
        description: 'Expert guidance on relationships and personal connections',
        icon: 'FiUsers',
        order: 7
      },
      {
        name: 'Technology & IT',
        slug: 'technology-it',
        description: 'Get technical guidance from IT professionals',
        icon: 'FiMonitor',
        order: 8
      }
    ]);
    console.log('✅ Categories created:', categories.length);

    // Create Admin User
    const adminUser = await User.create({
      name: 'ConsultOnCall Admin',
      email: 'admin@consultoncall.com',
      // IMPORTANT: keep plaintext here; User pre-save hook hashes it.
      password: 'admin@123',
      phone: '+1234567890',
      role: 'admin',
      tokens: 10000,
      isOnline: true,
      country: 'USA',
      avatar: 'https://randomuser.me/api/portraits/men/75.jpg'
    });
    console.log('✅ Admin user created');

    // Create 5 Regular Users
    const user1 = await User.create({
      name: 'John Smith',
      email: 'john@example.com',
      password: 'password123',
      phone: '+1987654321',
      role: 'user',
      tokens: 500,
      country: 'USA',
      isOnline: true,
      avatar: 'https://randomuser.me/api/portraits/men/22.jpg'
    });

    const user2 = await User.create({
      name: 'Emily Johnson',
      email: 'emily@example.com',
      password: 'password123',
      phone: '+1122334455',
      role: 'user',
      tokens: 750,
      country: 'UK',
      isOnline: false,
      avatar: 'https://randomuser.me/api/portraits/women/65.jpg'
    });

    const user3 = await User.create({
      name: 'Michael Brown',
      email: 'michael@example.com',
      password: 'password123',
      phone: '+1555666777',
      role: 'user',
      tokens: 300,
      country: 'Canada',
      isOnline: true,
      avatar: 'https://randomuser.me/api/portraits/men/38.jpg'
    });

    const user4 = await User.create({
      name: 'Sophia Martinez',
      email: 'sophia@example.com',
      password: 'password123',
      phone: '+1444333222',
      role: 'user',
      tokens: 850,
      country: 'India',
      isOnline: true,
      avatar: 'https://randomuser.me/api/portraits/women/12.jpg'
    });

    const user5 = await User.create({
      name: 'Daniel Wilson',
      email: 'daniel@example.com',
      password: 'password123',
      phone: '+1999888777',
      role: 'user',
      tokens: 420,
      country: 'Australia',
      isOnline: false,
      avatar: 'https://randomuser.me/api/portraits/men/54.jpg'
    });

    console.log('✅ Regular users created: 5');

    // Create 5 Expert Users
    const expertUser1 = await User.create({
      name: 'Dr. Sarah Williams',
      email: 'sarah@example.com',
      password: 'password123',
      phone: '+1111222333',
      role: 'expert',
      tokens: 0,
      country: 'USA',
      isOnline: true,
      avatar: 'https://randomuser.me/api/portraits/women/44.jpg'
    });

    const expertUser2 = await User.create({
      name: 'James Anderson',
      email: 'james@example.com',
      password: 'password123',
      phone: '+1444555666',
      role: 'expert',
      tokens: 0,
      country: 'UK',
      isOnline: true,
      avatar: 'https://randomuser.me/api/portraits/men/32.jpg'
    });

    const expertUser3 = await User.create({
      name: 'Dr. Lisa Thompson',
      email: 'lisa@example.com',
      password: 'password123',
      phone: '+1777888999',
      role: 'expert',
      tokens: 0,
      country: 'Canada',
      isOnline: false,
      avatar: 'https://randomuser.me/api/portraits/women/68.jpg'
    });

    const expertUser4 = await User.create({
      name: 'Robert Davis',
      email: 'robert@example.com',
      password: 'password123',
      phone: '+1000111222',
      role: 'expert',
      tokens: 0,
      country: 'India',
      isOnline: true,
      avatar: 'https://randomuser.me/api/portraits/men/45.jpg'
    });

    const expertUser5 = await User.create({
      name: 'Dr. Amanda Miller',
      email: 'amanda@example.com',
      password: 'password123',
      phone: '+1333444555',
      role: 'expert',
      tokens: 0,
      country: 'Australia',
      isOnline: true,
      avatar: 'https://randomuser.me/api/portraits/women/28.jpg'
    });

    console.log('✅ Expert users created: 5');

    // Create Expert Profiles
    const expertProfile1 = await Expert.create({
      user: expertUser1._id,
      title: 'Career Development Coach',
      bio: 'Helping professionals navigate career transitions and achieve their goals for over 15 years.',
      categories: [categories[0]._id, categories[4]._id],
      tokensPerMinute: 25,
      experience: 15,
      skills: ['Career Planning', 'Resume Writing', 'Interview Prep', 'Leadership'],
      languages: ['English', 'Spanish'],
      country: 'USA',
      rating: 4.8,
      totalRatings: 127,
      totalCalls: 315,
      totalMinutes: 8450,
      tokensEarned: 189550,
      tokensClaimed: 150000,
      unclaimedTokens: 39550,
      isVerified: true,
      isApproved: true,
      approvedBy: adminUser._id,
      approvedAt: new Date(),
      isAvailable: true,
      isOnline: true,
      isBusy: false
    });

    const expertProfile2 = await Expert.create({
      user: expertUser2._id,
      title: 'Licensed Mental Health Counselor',
      bio: 'Certified therapist specializing in anxiety, depression, and stress management.',
      categories: [categories[1]._id],
      tokensPerMinute: 30,
      experience: 10,
      skills: ['CBT', 'Mindfulness', 'Stress Management', 'Anxiety Treatment'],
      languages: ['English'],
      country: 'UK',
      rating: 4.9,
      totalRatings: 215,
      totalCalls: 428,
      totalMinutes: 12840,
      tokensEarned: 346680,
      tokensClaimed: 300000,
      unclaimedTokens: 46680,
      isVerified: true,
      isApproved: true,
      approvedBy: adminUser._id,
      approvedAt: new Date(),
      isAvailable: true,
      isOnline: true,
      isBusy: false
    });

    const expertProfile3 = await Expert.create({
      user: expertUser3._id,
      title: 'Corporate Lawyer',
      bio: 'Expert in business law, contracts, and corporate compliance with 12 years of experience.',
      categories: [categories[2]._id],
      tokensPerMinute: 40,
      experience: 12,
      skills: ['Contract Law', 'Corporate Law', 'Compliance', 'IP Rights'],
      languages: ['English', 'French'],
      country: 'Canada',
      rating: 4.7,
      totalRatings: 98,
      totalCalls: 187,
      totalMinutes: 5610,
      tokensEarned: 201960,
      tokensClaimed: 180000,
      unclaimedTokens: 21960,
      isVerified: true,
      isApproved: true,
      approvedBy: adminUser._id,
      approvedAt: new Date(),
      isAvailable: true,
      isOnline: false,
      isBusy: false
    });

    const expertProfile4 = await Expert.create({
      user: expertUser4._id,
      title: 'Certified Financial Planner',
      bio: 'Helping individuals and businesses with investment strategies and financial planning.',
      categories: [categories[3]._id],
      tokensPerMinute: 35,
      experience: 8,
      skills: ['Investment Planning', 'Retirement Planning', 'Tax Planning', 'Wealth Management'],
      languages: ['English', 'Hindi'],
      country: 'India',
      rating: 4.6,
      totalRatings: 142,
      totalCalls: 256,
      totalMinutes: 7680,
      tokensEarned: 242880,
      tokensClaimed: 200000,
      unclaimedTokens: 42880,
      isVerified: true,
      isApproved: true,
      approvedBy: adminUser._id,
      approvedAt: new Date(),
      isAvailable: true,
      isOnline: true,
      isBusy: false
    });

    const expertProfile5 = await Expert.create({
      user: expertUser5._id,
      title: 'Certified Fitness & Nutrition Expert',
      bio: 'Personalized fitness programs and nutrition plans for a healthier lifestyle.',
      categories: [categories[5]._id],
      tokensPerMinute: 20,
      experience: 6,
      skills: ['Fitness Training', 'Nutrition Planning', 'Weight Management', 'Yoga'],
      languages: ['English'],
      country: 'Australia',
      rating: 4.8,
      totalRatings: 178,
      totalCalls: 342,
      totalMinutes: 10260,
      tokensEarned: 184680,
      tokensClaimed: 150000,
      unclaimedTokens: 34680,
      isVerified: true,
      isApproved: true,
      approvedBy: adminUser._id,
      approvedAt: new Date(),
      isAvailable: true,
      isOnline: true,
      isBusy: false
    });

    console.log('✅ Expert profiles created: 5');

    console.log('\n🎉 Database seeded successfully!\n');
    console.log('═══════════════════════════════════════');
    console.log('📋 LOGIN CREDENTIALS');
    console.log('═══════════════════════════════════════\n');
    
    console.log('👑 ADMIN:');
    console.log('   Email: admin@consultoncall.com');
    console.log('   Password: admin@123');
    console.log('   Balance: ₹10,000\n');
    
    console.log('👤 USERS (All have ₹10 initial credit + extra):');
    console.log('   1. john@example.com (₹500) - USA');
    console.log('   2. emily@example.com (₹750) - UK');
    console.log('   3. michael@example.com (₹300) - Canada');
    console.log('   4. sophia@example.com (₹850) - India');
    console.log('   5. daniel@example.com (₹420) - Australia');
    console.log('   Password: password123\n');
    
    console.log('👨‍💼 EXPERTS (All Approved & Verified):');
    console.log('   1. sarah@example.com - Career Coach (₹25/min) - USA');
    console.log('   2. james@example.com - Mental Health (₹30/min) - UK');
    console.log('   3. lisa@example.com - Corporate Lawyer (₹40/min) - Canada');
    console.log('   4. robert@example.com - Financial Planner (₹35/min) - India');
    console.log('   5. amanda@example.com - Fitness Expert (₹20/min) - Australia');
    console.log('   Password: password123\n');
    
    console.log('═══════════════════════════════════════');
    console.log('✨ ConsultOnCall is ready to use!');
    console.log('═══════════════════════════════════════\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Seed error:', error);
    process.exit(1);
  }
};

seedDatabase();
