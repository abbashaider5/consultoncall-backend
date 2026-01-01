const express = require('express');
const mongoose = require('mongoose');
const Category = require('../models/Category');
const Expert = require('../models/Expert');
const { auth, adminAuth } = require('../middleware/auth');

const router = express.Router();

// Get all categories with expert count
router.get('/', async (req, res) => {
  console.log('Categories route called');
  console.log('MongoDB connection state:', mongoose.connection.readyState);

  try {
    const categories = await Category.find({ isActive: true }).sort({ order: 1, name: 1 }).lean();
    console.log('Found categories:', categories.length);
    
    // Add expert counts efficiently
    const categoriesWithCounts = await Promise.all(
      (categories || []).map(async (category) => {
        try {
          const expertCount = await Expert.countDocuments({ 
            categories: category._id,
            isApproved: true 
          });
          const onlineCount = await Expert.countDocuments({ 
            categories: category._id, 
            isOnline: true,
            isApproved: true 
          });
          return {
            ...category,
            expertCount: expertCount || 0,
            onlineCount: onlineCount || 0
          };
        } catch (err) {
          return {
            ...category,
            expertCount: 0,
            onlineCount: 0
          };
        }
      })
    );
    
    res.status(200).json({ 
      success: true, 
      data: categoriesWithCounts
    });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch categories',
      data: []
    });
  }
});

// Get single category with experts
router.get('/:slug', async (req, res) => {
  try {
    const category = await Category.findOne({ slug: req.params.slug, isActive: true });
    
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    const experts = await Expert.find({ categories: category._id })
      .populate('user', 'name email avatar')
      .populate('categories', 'name slug icon')
      .sort({ isOnline: -1, rating: -1 });

    res.json({
      category,
      experts
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Create category (admin only)
router.post('/', adminAuth, async (req, res) => {
  try {
    const { name, description, icon, image, order } = req.body;

    const existingCategory = await Category.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } });
    if (existingCategory) {
      return res.status(400).json({ message: 'Category already exists' });
    }

    const category = new Category({
      name,
      description,
      icon: icon || '💼',
      image,
      order: order || 0
    });

    await category.save();
    res.status(201).json(category);
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update category (admin only)
router.put('/:id', adminAuth, async (req, res) => {
  try {
    const { name, description, icon, image, order, isActive } = req.body;

    const category = await Category.findByIdAndUpdate(
      req.params.id,
      { name, description, icon, image, order, isActive },
      { new: true }
    );

    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    res.json(category);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete category (admin only)
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    const category = await Category.findByIdAndDelete(req.params.id);
    
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    // Remove category from all experts
    await Expert.updateMany(
      { categories: req.params.id },
      { $pull: { categories: req.params.id } }
    );

    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Seed default categories - ADMIN ONLY
router.post('/seed', adminAuth, async (req, res) => {
  try {
    const toSlug = (value) =>
      String(value || '')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^\w-]+/g, '');

    const defaultCategories = [
      { name: 'MERN Stack', description: 'MongoDB, Express, React, Node.js development', icon: '💻', order: 1 },
      { name: 'React', description: 'React.js frontend development', icon: '⚛️', order: 2 },
      { name: 'Node.js', description: 'Node.js backend development', icon: '🟢', order: 3 },
      { name: 'Python', description: 'Python programming and development', icon: '🐍', order: 4 },
      { name: 'Data Science', description: 'Data analysis and machine learning', icon: '📊', order: 5 },
      { name: 'Doctors', description: 'Medical consultation and advice', icon: '👨‍⚕️', order: 6 },
      { name: 'Lawyers', description: 'Legal advice and consultation', icon: '⚖️', order: 7 },
      { name: 'Career Counseling', description: 'Career guidance and mentorship', icon: '🎯', order: 8 },
      { name: 'Financial Advisor', description: 'Financial planning and investment advice', icon: '💰', order: 9 },
      { name: 'Mental Health', description: 'Therapy and counseling', icon: '🧠', order: 10 }
    ];

    for (const cat of defaultCategories) {
      const existing = await Category.findOne({ name: cat.name });
      if (!existing) {
        const category = new Category({
          ...cat,
          slug: cat.slug || toSlug(cat.name)
        });
        await category.save();
      }
    }

    const categories = await Category.find({ isActive: true }).sort({ order: 1 });
    res.json({ message: 'Categories seeded successfully', categories });
  } catch (error) {
    console.error('Seed categories error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
